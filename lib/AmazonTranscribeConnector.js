const { Transform } = require('stream');
const { EventEmitter } = require('events');
const {
    TranscribeStreamingClient,
    StartStreamTranscriptionCommand,
} = require("@aws-sdk/client-transcribe-streaming");
const config = require('config');
const cuid =  require('cuid');

class AmazonTranscribeConnector extends EventEmitter {
    constructor(audioConfig, id, log) {
        super();
        this.log = log.child({ id, platform: 'amazon' });

        this.client = new TranscribeStreamingClient({
            credentials: config.get('amazon.credentials'),
            region: config.get('amazon.region')
        });

        this.audioConfig = audioConfig;
        this.currentId = cuid();
    }

    _newId() {
        this.currentId = cuid();
        return this.currentId;
    }

    async _speechRecognitionResult(response) {

        // This snippet should be put into an async function
        for await (const event of response.TranscriptResultStream) {
            if (event.TranscriptEvent && event.TranscriptEvent.Transcript.Results) {

                let results = event.TranscriptEvent.Transcript.Results;
                results.map((result) => {
                    this.emit('message', {
                        correctedTime: result.Endtime,
                        results: result.Alternatives,
                        id: this.currentId,
                        platform: 'amazon'
                    });
                    if (!result.IsPartial) {
                        this._newId();
                    }
                });
            }
        }


        // this.log.info(streamResults, 'STREAM RESULTS');
        // // Convert API result end time from seconds + nanoseconds to milliseconds
        // this.resultEndTime = (
        //     (streamResults.results[0].resultEndTime.seconds * 1000)
        //     + Math.round(streamResults.results[0].resultEndTime.nanos / 1000000)
        // );

        // // Calculate correct time based on offset from audio sent twice
        // const correctedTime = this.resultEndTime - this.bridgingOffset + this.streamingLimit * this.restartCounter;

        // if (streamResults.results[0].isFinal) {
        //     this.isFinalEndTime = this.resultEndTime;
        //     this.lastTranscriptWasFinal = true;
        // } else {
        //     this.lastTranscriptWasFinal = false;
        // }

        // this.emit('message', {
        //     correctedTime,
        //     results: streamResults.results[0],
        //     id: this.currentId
        // });

        // if (streamResults.results[0].isFinal) {
        //     this._newId();
        // }
    };

    // _audioInputStreamTransform () {
    //     return new Transform({
    //         transform: (chunk, encoding, callback) => {

    //             if (this.newStream && this.lastAudioInput.length !== 0) {
    //                 // Approximate math to calculate time of chunks
    //                 const chunkTime = this.streamingLimit / this.lastAudioInput.length;
    //                 if (chunkTime !== 0) {
    //                     if (this.bridgingOffset < 0) {
    //                         this.bridgingOffset = 0;
    //                     }
    //                     if (this.bridgingOffset > this.finalRequestEndTime) {
    //                         this.bridgingOffset = this.finalRequestEndTime;
    //                     }
    //                     const chunksFromMS = Math.floor(
    //                         (this.finalRequestEndTime - this.bridgingOffset) / chunkTime
    //                     );
    //                     this.bridgingOffset = Math.floor(
    //                         (this.lastAudioInput.length - chunksFromMS) * chunkTime
    //                     );

    //                     for (let i = chunksFromMS; i < this.lastAudioInput.length; i++) {
    //                         if (this.recognizeStream && this.recognizeStream.writeable) {
    //                             this.recognizeStream.write(this.lastAudioInput[i]);
    //                         }

    //                     }
    //                 }
    //                 this.newStream = false;
    //             }

    //             this.audioInput.push(chunk);

    //             if (this.recognizeStream && this.recognizeStream.writable) {
    //                 this.recognizeStream.write(chunk);
    //             }

    //             callback();
    //         }
    //     });
    // }

    async _startRecognizeStream(audioPayloadStream) {
        this.log.info('starting a new stream to amazon');
        // Clear current audioInput
        //this.audioInput = [];
        // Initiate (Reinitiate) a recognize stream
        try {
            const audioStream = async function* () {
                for await (const payloadChunk of audioPayloadStream) {
                    yield { AudioEvent: { AudioChunk: payloadChunk } };
                }
            };

            const response = await this.client.send(new StartStreamTranscriptionCommand({
                LanguageCode: this.audioConfig.languageCode,
                MediaSampleRateHertz: this.audioConfig.sampleRateHertz,
                MediaEncoding: this.audioConfig.encoding,
                AudioStream: audioStream()
            }));

            await this._speechRecognitionResult(response);
        } catch(e) {
            if (e.name === "InternalFailureException") {
                /* handle InternalFailureException */
            } else if (e.name === "ConflictException") {
                /* handle ConflictException */
            }
        } finally {
          /* clean resources like input stream */
        }

        // Restart stream when streamingLimit expires
        //this.restarting = false;
        //this.globalTimeout = setTimeout(this._restartStream.bind(this), this.streamingLimit);
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
        this.log.info('starting recognition to amazon')
        this._startRecognizeStream(stream);
        // stream.pipe(this._audioInputStreamTransform());
    }
}

module.exports = AmazonTranscribeConnector;