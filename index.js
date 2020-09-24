const RtpServer = require('./lib/RTPServer');
const config = require('config');
const mqtt = require('async-mqtt');
const Pino = require('pino');
const GoogleCloudConnector = require('./lib/GoogleCloudConnector');
const AzureSpeechConnector = require('./lib/AzureSpeechConnector');
const AmazonTranscribeConnector = require('./lib/AmazonTranscribeConnector');
const log = new Pino({
    name: 'Dana-AudioServer',
});

let rtpServer = new RtpServer(config.get('rtpServer'), log);
const mqttTopicPrefix = config.get('mqtt.prefix');

let connectorsMap = new Map();
let mqttClient;

log.info('started');

async function createNewSTTStream(payload) {

    let audioDataStream = rtpServer.createStream(payload.port);
    connectorsMap.set(payload.channelId, new Map());

    if (config.get('google.enabled')) {
        createNewGoogleStream(payload, audioDataStream);
    }
    if (config.get('azure.enabled')) {
        createNewAzureStream(payload, audioDataStream);
    }
    if (config.get('amazon.enabled')) {
        createNewAmazonStream(payload, audioDataStream);
    }
}

async function createNewAzureStream(payload,audioDataStream) {
    log.info({ payload }, 'New Stream of audio from Asterisk to send to Azure');

    const languageCode = 'en-GB';

    const audioConfig = {
        languageCode
    }

    let azureSpeechConnector = new AzureSpeechConnector(audioConfig, payload.channelId, log);

    let map = connectorsMap.get(payload.channelId);
    map.set('azure', azureSpeechConnector);
    connectorsMap.set(payload.channelId, map);

    azureSpeechConnector.start(audioDataStream);

    azureSpeechConnector.on('message', async (data) => {
        log.info(`Got a message sending to ${mqttTopicPrefix}/${payload.roomName}/transcription`);
        await mqttClient.publish(`${mqttTopicPrefix}/${payload.roomName}/transcription`, JSON.stringify({ ...data, callerName: payload.callerName }));
    });
}

async function createNewAmazonStream(payload, audioDataStream) {

    log.info({ payload }, 'New Stream of audio from Asterisk to send to Amazon');

    // these are set here so that we can overwrite them from Asterisk
    const encoding = 'pcm';
    const sampleRateHertz = 16000;
    const languageCode = 'en-US';

    const audioConfig = {
        encoding,
        sampleRateHertz,
        languageCode,
    };

    let amazonTranscribeConnector = new AmazonTranscribeConnector(audioConfig, payload.channelId, log);

    let map = connectorsMap.get(payload.channelId);
    map.set('amazon', amazonTranscribeConnector);
    connectorsMap.set(payload.channelId, map);

    amazonTranscribeConnector.start(audioDataStream);

    amazonTranscribeConnector.on('message', async (data) => {
        log.info(`Got a message sending to ${mqttTopicPrefix}/${payload.roomName}/transcription`);
        await mqttClient.publish(`${mqttTopicPrefix}/${payload.roomName}/transcription`, JSON.stringify({ ...data, callerName: payload.callerName }));
    });
}

async function createNewGoogleStream(payload, audioDataStream) {

    log.info({ payload }, 'New Stream of audio from Asterisk to send to Google');

    // these are set here so that we can overwrite them from Asterisk
    const encoding = 'LINEAR16';
    const sampleRateHertz = 16000;
    const languageCode = 'en-GB'; // https://cloud.google.com/speech-to-text/docs/languages
    //const alternativeLanguageCodes = ['en-US']; //not available for this model
    const audioChannelCount = 1;
    const enableSeparateRecognitionPerChannel = false; //if asterisk was able to send us multiple channels, one per speaker that would be amazing, we could even make a multi channel audio stream here to save on cost?
    const maxAlternatives = 1;
    const model = 'phone_call'; //phone_call', 'video', 'default'
    const useEnhanced = true;
    const profanityFilter = false;
    const enableAutomaticPunctuation = true;
    const enableWordTimeOffsets = true;
    const enableWordConfidence = true;
    const metadata = {
        interactionType: 'PHONE_CALL',
        microphoneDistance: 'NEARFIELD',
        originalMediaType: 'AUDIO',
        recordingDeviceType: 'PC',
        recordingDeviceName: 'WebRTC',
    };

    // you may only want to have one stream from each conference so you'd need to add diarizationConfig into the config object
    // const diarizationConfig = {
    //     enableSpeakerDiarization: true,
    //     minSpeakerCount: 2,
    //     maxSpeakerCount: 10
    // };

    const streamingLimit = 290000;

    const audioConfig = {
        encoding,
        sampleRateHertz,
        languageCode,
        //alternativeLanguageCodes,
        audioChannelCount,
        enableSeparateRecognitionPerChannel,
        maxAlternatives,
        model,
        useEnhanced,
        profanityFilter,
        enableAutomaticPunctuation,
        enableWordTimeOffsets,
        enableWordConfidence,
        metadata
    };

    let googleStreamConnector = new GoogleCloudConnector(audioConfig, streamingLimit, payload.channelId, log);

    let map = connectorsMap.get(payload.channelId);
    map.set('google', googleStreamConnector);
    connectorsMap.set(payload.channelId, map);

    googleStreamConnector.start(audioDataStream);

    googleStreamConnector.on('message', async (data) => {
        log.info(`Got a message sending to ${mqttTopicPrefix}/${payload.roomName}/transcription`);
        await mqttClient.publish(`${mqttTopicPrefix}/${payload.roomName}/transcription`, JSON.stringify({ ...data, callerName: payload.callerName }));
    });
}

function stopSTTStream(payload) {
    log.info({ payload }, 'Ending stream of audio from Asterisk to send to Google');

    let connectors = connectorsMap.get(payload.channelId);

    if (connectors) {
        //loop through the providers
        connectors.forEach((connector, key) => {
            connector.end();
            connectors.delete(key);
        })
        connectorsMap.delete(payload.channelId);
    }

    rtpServer.endStream(payload.port);
}

async function run() {

    mqttClient = await mqtt.connectAsync(config.get('mqtt.url'));
    log.info('Connected to MQTT');

    await mqttClient.subscribe(`${mqttTopicPrefix}/newStream`);
    await mqttClient.subscribe(`${mqttTopicPrefix}/streamEnded`);
    log.info('Subscribed to both newStream & streamEnded topic');

    mqttClient.on('message', (topic, message) => {
        let payload = JSON.parse(message.toString());

        switch(topic) {
            case `${mqttTopicPrefix}/newStream`:
                createNewSTTStream(payload);
                break;
            case `${mqttTopicPrefix}/streamEnded`:
                stopSTTStream(payload);
                break;
            default:
                break;
        }
    });

    rtpServer.on('err', (err) => {

        streamsMap.forEach((stream, key) => {
            stream.end();
            streamsMap.delete(key);
        });

        throw err;
    });

    rtpServer.bind();
    log.info('AudioServer listening on UDP port');
}

run();
