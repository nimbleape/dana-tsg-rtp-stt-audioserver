const { Transform } = require('stream');
const { EventEmitter } = require('events');
const speech = require('@google-cloud/speech').v1p1beta1;
const config = require('config');
const cuid =  require('cuid');

class GoogleCloudConnector extends EventEmitter {
    constructor(audioConfig, streamingLimit, id, log) {
        super();
        this.log = log.child({ id });
        this.streamingLimit = streamingLimit;
        this.globalTimeout;

        this.client = new speech.SpeechClient(config.get('google'));

        this.restarting = false;
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
        this.currentId = cuid();

        this.streamingRequestConfig = {
            config: audioConfig,
            single_utterance: false,
            interimResults: true,
        };
    }

    _newId() {
        this.currentId = cuid();
        return this.currentId;
    }

    _restartStream() {
        if (this.restarting) {
            return;
        }
        this.restarting = true;
        this.log.info('attempting to restart stream');

        clearTimeout(this.globalTimeout);

        let oldStream = null;

        if (this.recognizeStream) {
            oldStream = this.recognizeStream;
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

        if (oldStream) {
            this.log.info('destroying oldStream');
            oldStream.removeAllListeners('close');
            oldStream.removeAllListeners('finish');
            oldStream.removeAllListeners('data');
            oldStream.destroy();
        }
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
            results: streamResults.results[0],
            id: this.currentId
        });

        if (streamResults.results[0].isFinal) {
            this._newId();
        }
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
                            if (this.recognizeStream && this.recognizeStream.writeable) {
                                this.recognizeStream.write(this.lastAudioInput[i]);
                            }

                        }
                    }
                    this.newStream = false;
                }

                this.audioInput.push(chunk);

                if (this.recognizeStream && this.recognizeStream.writable) {
                    this.recognizeStream.write(chunk);
                }

                callback();
            }
        });
    }

    _startRecognizeStream() {
        this.log.info('starting a new stream to google');
        // Clear current audioInput
        this.audioInput = [];
        // Initiate (Reinitiate) a recognize stream
        this.recognizeStream = this.client
            .streamingRecognize(this.streamingRequestConfig)
            .once('error', (err) => {
                this.log.error({ err }, 'Google API request error');
                this.recognizeStream.on('error', (err) => {
                    this.log.info({ err }, 'Error on previously used recognizeStream');
                });

                this._restartStream();
            })
            .on('data', this._speechRecognitionResult.bind(this))
            .once('finish', () => {
                this.log.info('recognizeStream has finished');
                this._restartStream();
            })
            .once('close', () => {
                this.log.info('recognizeStream has closed');
                this._restartStream();
            });

        // Restart stream when streamingLimit expires
        this.restarting = false;
        this.globalTimeout = setTimeout(this._restartStream.bind(this), this.streamingLimit);
    }

    end () {
        if (this.recognizeStream) {
            this.recognizeStream.removeAllListeners('finish');
            this.recognizeStream.removeAllListeners('close');
            this.recognizeStream.removeAllListeners('data');
            this.recognizeStream.end();
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