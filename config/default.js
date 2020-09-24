module.exports = {
    rtpServer: {
        port: 7777,
        host: '127.0.0.1',
        swap16: true
    },
    mqtt: {
        url: 'mqtt://test.mosquitto.org',
        prefix: 'danatsg'
    },
    google: {
        enabled: true,
        keyFilename: 'foo.json'
    },
    azure: {
        enabled: true,
        region: 'uksouth',
        subscriptionKey: 'key'
    },
    amazon: {
        enabled: true,
        credentials: {
            accessKeyId: 'key',
            secretAccessKey: 'key',
        },
        region: 'eu-west-1'
    }
}