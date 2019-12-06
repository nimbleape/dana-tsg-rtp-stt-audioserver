const RtpServer = require('./lib/RtpServer');
const config = require('config');
const mqtt = require('async-mqtt');
const Pino = require('pino');
const GoogleCloudConnector = require('./lib/GoogleCloudConnector');
const log = new Pino({
    name: 'Dana-AudioServer',
});

let rtpServer = new RtpServer(config.get('rtpServer'), log);
const mqttTopicPrefix = config.get('mqtt.prefix');

let connectorsMap = new Map();
let mqttClient;

async function createNewGoogleStream(payload) {

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

    connectorsMap.set(payload.channelId, googleStreamConnector);

    let audioDataStream = rtpServer.createStream(payload.port);

    googleStreamConnector.start(audioDataStream);

    googleStreamConnector.on('message', async (data) => {
        log.info(`Got a message sending to ${mqttTopicPrefix}/${payload.roomName}/transcription`);
        await mqttClient.publish(`${mqttTopicPrefix}/${payload.roomName}/transcription`, JSON.stringify({ ...data, callerName: payload.callerName }));
    });
}

function stopGoogleStream(payload) {
    log.info({ payload }, 'Ending stream of audio from Asterisk to send to Google');

    let connector = connectorsMap.get(payload.channelId);

    if (connector) {
        connector.end();
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
                createNewGoogleStream(payload);
                break;
            case `${mqttTopicPrefix}/streamEnded`:
                stopGoogleStream(payload);
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
