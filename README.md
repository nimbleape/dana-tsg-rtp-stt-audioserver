# Dana TSG RTP STT AudioServer

This application takes UDP audio from Asterisk sent using the External Media application in ARI, and pipes it up to Google's Speech To Text Engine. It takes messaging via MQTT to inform it of a new incoming stream with the associated source port so that we can then assoicate the stream with a specific participant and bridge name.

Once it gets the transcription results from Google, we then push them back into MQTT so that the browser connected to MQTT via WSS is able to get pushed the transcriptions

## Requirements

* Node 10+
* Asterisk 16.6 onwards (but not 17 yet oddly)
* [Dana-TSG-ARI-Bridge](https://github.com/nimbleape/dana-tsg-ari-bridge) running elsewhere
* MQTT Server
* Google Cloud credentials

## Install

```
yarn
```

## Run

Set your config settings in `config/default.js` (or `config/production.js` if you're running with `NODE_ENV=production`)

```
yarn start
```

## Logging

This project uses Pino as it's logging library which outputs JSON to the console. You can make this easier ot read using `pino-pretty` or just use the `yarn start-pretty` command.

## Dockerfile

The included Dockerfile is very opinionated. It uses multi stage builds and then uses a "distroless" Node.js image from Google. there's no point exec'ing into it because there's no bash terminal available etc. Use it as Docker should be used :)
