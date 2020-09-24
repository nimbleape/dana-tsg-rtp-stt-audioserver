const { Transform } = require('stream');
const { EventEmitter } = require('events');
const sdk = require('microsoft-cognitiveservices-speech-sdk');
const config = require('config');
const cuid =  require('cuid');

class AzureSpeechConnector extends EventEmitter {
    constructor(audioConfig, id, log) {
        super();
        this.log = log.child({ id, platform: 'azure' });

        this.clientConfig = sdk.SpeechConfig.fromSubscription(config.get('azure.subscriptionKey'), config.get('azure.region'))
        this.clientConfig.speechRecognitionLanguage = audioConfig.languageCode;
        this.clientConfig.requestWordLevelTimestamps();
        this.clientConfig.enableAudioLogging();
        this.clientConfig.enableDictation();
        this.clientConfig.setProfanity(2);

        this.recognizeStream = null;
        this.currentId = cuid();
    }

    _newId() {
        this.currentId = cuid();
        return this.currentId;
    }

    _speechRecognitionResult(type, sender, event) {
        this.log.info('AZURE STREAM RESULTS');

        let correctedTime = (event.result.offset + event.result.duration) / 10000000;

        let result  = {
            text: event.result.text,
            language: event.result.language,
            duration: event.result.duration,
            languageDetectionConfidence: event.result.languageDetectionConfidence,
            reason: event.result.reason,
        }

        console.log({result, correctedTime})

        if (type === 'recognizing') {
            this.emit('message', {
                platform: 'azure',
                correctedTime,
                results: result,
                id: this.currentId
            });
        } else if (type === 'recognized') {

            if (event.result.reason == sdk.ResultReason.RecognizedSpeech) {
                this.emit('message', {
                    platform: 'azure',
                    correctedTime,
                    results: result,
                    id: this.currentId
                });
                this._newId();
            }
            else if (event.result.reason == sdk.ResultReason.NoMatch) {
                this.log.info("NOMATCH: Speech could not be recognized.");
            }
        }
    };

    _audioInputStreamTransform () {
        return new Transform({
            transform: (chunk, encoding, callback) => {
                if (this.recognizeStream) {
                    this.recognizeStream.write(chunk);
                }

                callback();
            }
        });
    }

    _startRecognizeStream(stream) {
        this.log.info('starting a new stream to google');
        // Initiate (Reinitiate) a recognize stream
        this.recognizeStream = sdk.AudioInputStream.createPushStream()
        let audioConfig = sdk.AudioConfig.fromStreamInput(this.recognizeStream);
        this.client = new sdk.SpeechRecognizer(this.clientConfig, audioConfig);

        this.client.recognizing = this._speechRecognitionResult.bind(this, 'recognizing');

        this.client.recognized = this._speechRecognitionResult.bind(this, 'recognized');

        this.client.canceled = (sender, event) => {
            this.log.info(event, `CANCELED: Reason`);

            if (event.reason == CancellationReason.Error) {
                this.log.info(event, 'Error due to Cancellation')
            }

            this.client.stopContinuousRecognitionAsync();
        };

        this.client.sessionStopped = (sender, event) => {
            console.log("\n    Session stopped event.");
            this.client.stopContinuousRecognitionAsync();
        };

        this.client.startContinuousRecognitionAsync(
            () => {
                this.log.info('started azure recog');
            },
            (err) => {
                this.log.trace(err, 'Error from Azure recog');

                this.client.close();
                this.client = undefined;
            }
        )
    }

    end () {
        if (this.client) {
            this.client.close()
        }
        if (this.globalTimeout) {
            clearTimeout(this.globalTimeout);
        }
    }

    start(stream) {
        this.log.info('starting recognition to azure')
        let transformedStream = this._audioInputStreamTransform();
        this._startRecognizeStream();
        stream.pipe(transformedStream);
    }
}

module.exports = AzureSpeechConnector;