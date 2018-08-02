const tcp = require('net');
const Connection = require('./lib/connection');

class RTMPServer extends tcp.Server {
  constructor(opts) {
    super(opts);
    this.channels = new Map();
    this.sessions = new Map();
    this.producers = {};
    this.on('connection', socket => {
      const session = new Connection(socket);
      session.id = this.generateNewSessionID();
      this.emit('client', session);
    });
    this.on('client', session => {
      const { id } = session;
      this.sessions.set(id, session);
      session.once('end', () => {
        this.sessions.delete(id);
        this.emit('offline', session);
      });
      session.on('connect', this.onConnect.bind(this, session));
      session.on('audio', this.onAudio.bind(this, session));
      session.on('video', this.onVideo.bind(this, session));
      session.on('audio-ready', this.onAudioReady.bind(this, session));
      session.on('video-ready', this.onVideoReady.bind(this, session));
      session.on('publish', this.onPublish.bind(this, session));
      session.on('play', this.onPlay.bind(this, session));
      session.on('command', this.handleCommand.bind(this, session));
      session.on('AMFDataMessage:@setDataFrame:onMetaData', cmd => {
        const { streamName } = session;
        const producer = this.producers[streamName];
        producer.metaData = cmd.cmdObj;
        session.startPlay(producer);
      });
    });
  }

  generateNewSessionID() {
    const SESSION_ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const SESSION_ID_LENGTH = 12;
    let sessionId;
    do {
      sessionId = '';
      for (let i = 0; i < SESSION_ID_LENGTH; i++) {
        const charIndex = (Math.random() * SESSION_ID_CHARS.length) | 0;
        sessionId += SESSION_ID_CHARS.charAt(charIndex);
      }
    } while (this.sessions.has(sessionId));
    return sessionId;
  }
  onConnect(client, cmd){
    Object.assign(client, cmd.cmdObj);
    client.windowACK(5000000);
    client.setPeerBandwidth(5000000, 2);
    client.outChunkSize = 4096;
    client.setChunkSize(client.outChunkSize);
    client.respondConnect();
  }
  onAudioReady(client, audio){
    const streamName = client.streamName;
    const producer = this.producers[streamName];
    producer.cacheAudioSequenceBuffer = audio;
    for (var id in producer.consumers) {
      producer.consumers[id].startPlay(producer);
    }
  }
  onVideoReady(client, video){
    const streamName = client.streamName;
    const producer = this.producers[streamName];
    producer.cacheVideoSequenceBuffer = Buffer.from(video);
    for (var id in producer.consumers) {
      producer.consumers[id].startPlay(producer);
    }
  }
  onAudio(client, header, audio){
    const { streamName } = client;
    const producer = this.producers[streamName];
    for (var id in producer.consumers) {
      producer.consumers[id].pushAudio(audio, header.timestamp);
    }
  }
  onVideo(client, header, video){
    const { streamName } = client;
    const producer = this.producers[streamName];
    for (var id in producer.consumers) {
      producer.consumers[id].pushVideo(video, header.timestamp);
    }
  }
  onPlay(client, cmd){
    const streamName = client.streamName = client.app + '/' + cmd.streamName;
    if (!this.producers[streamName]) {
      console.info("[rtmp streamPlay]  There's no stream named " + streamName + " is" +
        " publushing! Create a producer.");
      this.producers[streamName] = {
        id: null,
        consumers: {}
      };
    } else if (this.producers[streamName].id == null) {
      console.info("[rtmp streamPlay]  There's no stream named " + streamName + " is " +
        "publushing! But the producer is created.");
    } else {
      console.info("[rtmp streamPlay]  There's a  stream named " + streamName + " is " +
        "publushing! id=" + this.producers[streamName].id);
    }
    this.producers[streamName].consumers[client.id] = client;
    const producer = this.producers[streamName];
    client.respondPlay();
    client.startPlay(producer);
  }
  onPublish(client, cmd){
    const streamName = client.streamName = client.app + '/' + cmd.streamName;
    if (!this.producers[streamName]) {
      this.producers[streamName] = {
        id: client.id,
        consumers: {}
      };
    } else if (this.producers[streamName].id == null) {
      this.producers[streamName].id = client.id;
    } else {
      console.warn("[rtmp publish] Already has a stream named " + streamName);
      client.respondPublishError();
      return;
    }
    client.respondPublish();
  }
  handleCommand(client, cmd){
    switch (cmd.cmd) {
      case 'createStream':
        client.respondCreateStream(cmd);
        break;
      case 'getStreamLength':
        break;
      case 'closeStream':
        client.closeStream();
        break;
      case 'deleteStream':
        client.deleteStream();
        break;
      case 'pause':
        client.pauseOrUnpauseStream();
        break;
      case 'releaseStream':
        client.respondReleaseStream();
        break;
      case 'FCPublish':
        client.respondFCPublish();
        break;
      case 'FCUnpublish':
        client.respondFCUnpublish();
        break;
      default:
        console.warn("[rtmp:receive] unknown AMF command: " + cmd.cmd);
        return;
    }
  }
}

module.exports = RTMPServer;