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
    };

    async _startRecognizeStream(audioPayloadStream) {
        this.log.info('starting a new stream to amazon');
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
    }
}

module.exports = AmazonTranscribeConnector;