const { Transform } = require('stream');
const { EventEmitter } = require('events');
const speech = require('@google-cloud/speech').v1p1beta1;
const config = require('config');

class GoogleCloudConnector extends EventEmitter {
    constructor(audioConfig, streamingLimit, log) {
        super();
        this.log = log;
        this.streamingLimit = streamingLimit;
        this.globalTimeout;

        this.client = new speech.SpeechClient(config.get('google'));

        this.recognizeStream = null;
        this.restartCounter = 0;
        this.audioInput = [];
        this.lastAudioInput = [];
        this.resultEndTime = 0;
        this.isFinalEndTime = 0;
        this.finalRequestEndTime = 0;
        this.newStream = true;
        this.bridgingOffset = 0;
        this.lastTranscriptWasFinal = false;

        this.streamingRequestConfig = {
            config: audioConfig,
            single_utterance: false,
            interimResults: true,
        };
    }

    _restartStream() {
        clearTimeout(this.globalTimeout);

        if (this.recognizeStream) {
          this.recognizeStream.removeAllListeners('data');
          this.recognizeStream.removeAllListeners('error');
          this.recognizeStream.removeAllListeners('close');
          this.recognizeStream = null;
        }

        if (this.resultEndTime > 0) {
          this.finalRequestEndTime = this.isFinalEndTime;
        }

        this.resultEndTime = 0;

        this.lastAudioInput = [];
        this.lastAudioInput = this.audioInput;

        this.restartCounter++;

        this.newStream = true;


        this._startRecognizeStream();
    }

    _speechRecognitionResult(streamResults) {
        this.log.info(streamResults, 'STREAM RESULTS');
        // Convert API result end time from seconds + nanoseconds to milliseconds
        this.resultEndTime = (
            (streamResults.results[0].resultEndTime.seconds * 1000)
            + Math.round(streamResults.results[0].resultEndTime.nanos / 1000000)
        );

        // Calculate correct time based on offset from audio sent twice
        const correctedTime = this.resultEndTime - this.bridgingOffset + this.streamingLimit * this.restartCounter;

        if (streamResults.results[0].isFinal) {
            this.isFinalEndTime = this.resultEndTime;
            this.lastTranscriptWasFinal = true;
        } else {
            this.lastTranscriptWasFinal = false;
        }

        this.emit('message', {
            correctedTime,
            results: streamResults.results[0]
        });
    };

    _audioInputStreamTransform () {
        return new Transform({
            transform: (chunk, encoding, callback) => {

                if (this.newStream && this.lastAudioInput.length !== 0) {
                    // Approximate math to calculate time of chunks
                    const chunkTime = this.streamingLimit / this.lastAudioInput.length;
                    if (chunkTime !== 0) {
                        if (this.bridgingOffset < 0) {
                            this.bridgingOffset = 0;
                        }
                        if (this.bridgingOffset > this.finalRequestEndTime) {
                            this.bridgingOffset = this.finalRequestEndTime;
                        }
                        const chunksFromMS = Math.floor(
                            (this.finalRequestEndTime - this.bridgingOffset) / chunkTime
                        );
                        this.bridgingOffset = Math.floor(
                            (this.lastAudioInput.length - chunksFromMS) * chunkTime
                        );

                        for (let i = chunksFromMS; i < this.lastAudioInput.length; i++) {
                            if (this.recognizeStream && !this.recognizeStream.destroyed) {
                                this.log.info('CATCHING UP Is recognizeStream destroyed?', this.recognizeStream.destroyed);
                                this.recognizeStream.write(this.lastAudioInput[i]);
                            }

                        }
                    }
                    this.newStream = false;
                }

                this.audioInput.push(chunk);

                this.log.info('Is recognizeStream destroyed?', this.recognizeStream.destroyed);
                if (this.recognizeStream && !this.recognizeStream.destroyed) {
                    this.recognizeStream.write(chunk);
                }

                callback();
            }
        });
    }

    _startRecognizeStream() {
        // Clear current audioInput
        this.audioInput = [];
        // Initiate (Reinitiate) a recognize stream
        this.recognizeStream = this.client
            .streamingRecognize(this.streamingRequestConfig)
            .on('error', err => {
                this.log.error({ err }, 'Google API request error');
                this._restartStream();
            })
            .on('data', this._speechRecognitionResult.bind(this))
            .on('close', () => {
                this._restartStream();
            });

        // Restart stream when streamingLimit expires
        this.globalTimeout = setTimeout(this._restartStream.bind(this), this.streamingLimit);
    }

    end () {
        if (this.recognizeStream) {
            this.recognizeStream.removeAllListeners('close');
            this.recognizeStream.destroy();
        }
        if (this.globalTimeout) {
            clearTimeout(this.globalTimeout);
        }
    }

    start(stream) {
        this.log.info('starting recognition to google')
        this._startRecognizeStream();
        stream.pipe(this._audioInputStreamTransform());
    }
}

module.exports = GoogleCloudConnector;