const dgram = require('dgram');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

// TODO move this to await/async promises

class RtpUdpServerSocket extends EventEmitter {
    constructor(opts, log) {
        super();
        this.log = log;
        this.swap16 = opts.swap16 || false;
        this.host = opts.host;
        this.port = opts.port;
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
            //this.emit(`data-${rinfo.port}`, buf);
            this.emit(`data-12345`, buf);
        });

        return this.socket.bind(this.port, this.host);
    }

    createStream(port) {

        const stream = new PassThrough();

        this.log.info({ port }, 'Creating a new stream based on source port');

        stream.on('close', () => {
            this.log.info({ port }, 'removing event listener for data on port as stream finished');
            this.removeAllListeners(`data-${port}`);
        });

        this.log.info(`listening on data-${port} for data`);
        this.on(`data-${port}`, (data) => {
            if (!stream.destroyed) {
                stream.write(data);
            }
        });

        return stream;
    }
}

module.exports = RtpUdpServerSocket;