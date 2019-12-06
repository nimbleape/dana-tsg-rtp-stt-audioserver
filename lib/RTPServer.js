const dgram = require('dgram');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

// TODO move dgram to await/async promises

class RtpUdpServerSocket extends EventEmitter {
    constructor(opts, log) {
        super();
        this.log = log;
        this.swap16 = opts.swap16 || false;
        this.host = opts.host;
        this.port = opts.port;
        this.streams = new Map();
    }

    bind() {
        this.socket = dgram.createSocket('udp4');

        this.socket.on('error', (err) => {
            this.emit('error', err);
            this.socket.close();
        });

        this.socket.on('message', (msg, rinfo) => {
            /* Strip the 12 byte RTP header */
            let buf = msg.slice(12);
            if (this.swap16) {
                buf.swap16();
            }

            this.emit(`data-${rinfo.port}`, buf);
        });

        return this.socket.bind(this.port, this.host);
    }

    createStream(port) {

        const stream = new PassThrough();

        this.log.info({ port }, 'Creating a new stream based on source port');

        stream.on('close', () => {
            // not sure if this is actually working yet
            this.log.info({ port }, 'removing event listener for data on port as stream finished');
            this.removeAllListeners(`data-${port}`);
        });

        this.log.info(`listening on data-${port} for data`);

        this.once(`data-${port}`, () => {
            this.log.info(`Audio Stream started from port ${port}`);
        });

        this.on(`data-${port}`, (data) => {
            if (!stream.writeable) {
                stream.write(data);
            } else {
                this.log.info('Trying to write Audio to Passthrough stream when stream is not in a writeable state');
            }
        });

        this.streams.set(port, stream);

        return stream;
    }

    endStream(port) {
        this.removeAllListeners(`data-${port}`);
        let stream = this.streams.get(port);
        if (stream) {
            stream.end();
            this.streams.delete(port);
        }
    }
}

module.exports = RtpUdpServerSocket;