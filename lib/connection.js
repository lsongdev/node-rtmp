const AMF = require('./amf');
const Packet = require('./packet');
const Protocol = require('./protocol');
const BufferPool = require('./buffer-pool');

const aac_sample_rates = [
  96000, 88200, 64000, 48000,
  44100, 32000, 24000, 22050,
  16000, 12000, 11025, 8000,
  7350, 0, 0, 0
];

class Connection extends Protocol {

  constructor(socket) {
    super();

    this.socket = socket;
    this.isStarting = false;
    this.inChunkSize = 128;
    this.outChunkSize = 128;
    this.isFirstAudioReceived = true;
    this.isFirstVideoReceived = true;
    this.sendBufferQueue = [];
    this.codec = {
      width: 0,
      height: 0,
      duration: 0,
      framerate: 0,
      videodatarate: 0,
      audiosamplerate: 0,
      audiosamplesize: 0,
      audiodatarate: 0,
      spsLen: 0,
      sps: null,
      ppsLen: 0,
      pps: null
    };

    this.bp = new BufferPool();
    this.bp.on('error', () => {});
    this.parser = this.parseRtmpMessage(this);
    this.socket.on('data', data => this.bp.push(data));
    this.socket.on('error', err => {
      if (err.code === 'ECONNRESET') {
        this.emit('stop')
      } else {
        console.log(err.code)
      }
    })
    this.on('message', this.handleRtmpMessage.bind(this));
    this.bp.init(this.parser);
    this.isStarting = true;
  }

  pushAudio(audio, timestamp = 0){
    const packet = new Packet();
    packet.header.fmt = Packet.CHUNKS.TYPE_0;
    packet.header.cid = Packet.CHANNELS.AUDIO;
    packet.header.type = Packet.TYPES.AUDIO;
    packet.payload = audio;
    packet.header.length = audio.length;
    packet.header.timestamp = timestamp;
    this.sendBufferQueue.push(packet.toBuffer());
    return this;
  }
  pushVideo(video, timestamp = 0){
    const packet = new Packet();
    packet.header.stream_id = 1;
    packet.header.fmt = Packet.CHUNKS.TYPE_0;
    packet.header.cid = Packet.CHANNELS.VIDEO;
    packet.header.type = Packet.TYPES.VIDEO;
    packet.payload = video;
    packet.header.length = video.length;
    packet.header.timestamp = timestamp;
    this.sendBufferQueue.push(packet.toBuffer());
    return this;
  }

  stop() {
    this.isStarting = false;
    // console.info("Delete client from conns. ID: " + this.id);
    this.emit('stop');
  }

  handleRtmpMessage(rtmpHeader, rtmpBody) {
    switch (rtmpHeader.messageTypeID) {
      case 0x01:
        this.inChunkSize = rtmpBody.readUInt32BE(0);
        console.log('[rtmp handleRtmpMessage] Set In chunkSize:' + this.inChunkSize);
        break;

      case 0x04:
        var userControlMessage = this.parseUserControlMessage(rtmpBody);
        if (userControlMessage.eventType === 3) {
          var streamID = (userControlMessage.eventData[0] << 24) + (userControlMessage.eventData[1] << 16) + (userControlMessage.eventData[2] << 8) + userControlMessage.eventData[3];
          var bufferLength = (userControlMessage.eventData[4] << 24) + (userControlMessage.eventData[5] << 16) + (userControlMessage.eventData[6] << 8) + userControlMessage.eventData[7];
          console.log("[rtmp handleRtmpMessage] SetBufferLength: streamID=" + streamID +
            "bufferLength=" + bufferLength);
        } else if (userControlMessage.eventType === 7) {
          var timestamp = (userControlMessage.eventData[0] << 24) + (userControlMessage.eventData[1] << 16) + (userControlMessage.eventData[2] << 8) + userControlMessage.eventData[3];
          console.log("[rtmp handleRtmpMessage] PingResponse: timestamp=" + timestamp);
        } else {
          console.log("[rtmp handleRtmpMessage] User Control Message");
          console.log(userControlMessage);
        }
        break;
      case 0x08:
        //Audio Data
        // console.log(rtmpHeader);
        // console.log('Audio Data: ' + rtmpBody.length);
        this.parseAudioMessage(rtmpHeader, rtmpBody);
        break;
      case 0x09:
        //Video Data
        // console.log(rtmpHeader);
        // console.log('Video Data: ' + rtmpBody.length);
        this.parseVideoMessage(rtmpHeader, rtmpBody);
        break;
      case 0x0F:
        //AMF3 Data
        var cmd = AMF.decodeAmf0Cmd(rtmpBody.slice(1));
        this.handleAMFDataMessage(cmd, this);
        break;
      case 0x11:
        //AMF3 Command
        var cmd = AMF.decodeAmf0Cmd(rtmpBody.slice(1));
        this.handleAMFCommandMessage(cmd, this);
        break;
      case 0x12:
        //AMF0 Data
        var cmd = AMF.decodeAmf0Cmd(rtmpBody);
        this.handleAMFDataMessage(cmd, this);
        break;
      case 0x14:
        //AMF0 Command
        var cmd = AMF.decodeAmf0Cmd(rtmpBody);
        this.handleAMFCommandMessage(cmd, this);
        break;

    }
  }

  handleAMFDataMessage(cmd) {
    this.emit('AMFDataMessage', cmd);
    this.emit(`AMFDataMessage:${cmd.cmd}`, cmd);
    if (cmd.cmd === '@setDataFrame') {
      this.emit(`AMFDataMessage:@setDataFrame:${cmd.method}`, cmd);
    }
  }

  handleAMFCommandMessage(cmd) {
    this.emit('command', cmd);
    this.emit(cmd.cmd, cmd);
  }

  startPlay(producer = {}) {
    if (producer.metaData == null || producer.cacheAudioSequenceBuffer == null || producer.cacheVideoSequenceBuffer == null) return;
    var rtmpHeader = {
      chunkStreamID: 5,
      timestamp: 0,
      messageTypeID: 0x12,
      messageStreamID: 1
    };

    var opt = {
      cmd: 'onMetaData',
      cmdObj: producer.metaData
    };

    var rtmpBody = AMF.encodeAmf0Cmd(opt);
    var metaDataRtmpMessage = Packet.create(rtmpHeader, rtmpBody);
    var beginRtmpMessage = Buffer.from("020000000000060400000000000000000001", 'hex');
    this.sendBufferQueue.push(beginRtmpMessage);
    this.sendBufferQueue.push(metaDataRtmpMessage.toBuffer());
    this.pushAudio(producer.cacheAudioSequenceBuffer);
    this.pushVideo(producer.cacheVideoSequenceBuffer);
    this.sendRtmpMessage(this);
  }

  parseUserControlMessage(buf) {
    var eventData, eventType;
    var eventType = (buf[0] << 8) + buf[1];
    var eventData = buf.slice(2);
    var message = {
      eventType: eventType,
      eventData: eventData
    };
    if (eventType === 3) {
      message.streamID = (eventData[0] << 24) + (eventData[1] << 16) + (eventData[2] << 8) + eventData[3];
      message.bufferLength = (eventData[4] << 24) + (eventData[5] << 16) + (eventData[6] << 8) + eventData[7];
    }
    return message;
  }

  parseAudioMessage(rtmpHeader, rtmpBody) {
    if (this.isFirstAudioReceived) {
      var sound = rtmpBody[0];
      var sound_type = sound & 0x01;
      var sound_size = (sound >> 1) & 0x01;
      var sound_rate = (sound >> 2) & 0x03;
      var sound_format = (sound >> 4) & 0x0f;
      if (sound_format != 10) {
        this.emit('error', new Error(`Only support audio aac codec. actual=${sound_format}`));
        return -1;
      }
      // console.info(this.id + " Parse AudioTagHeader sound_format=" + sound_format +
      //   "sound_type=" + sound_type + " sound_size=" + sound_size + " sound_rate=" + sound_rate);
      var aac_packet_type = rtmpBody[1];
      if (aac_packet_type == 0) {
        //AudioSpecificConfig
        // only need to decode  2bytes:
        // audioObjectType, aac_profile, 5bits.
        // samplingFrequencyIndex, aac_sample_rate, 4bits.
        // channelConfiguration, aac_channels, 4bits
        this.codec.aac_profile = rtmpBody[2];
        this.codec.aac_sample_rate = rtmpBody[3];

        this.codec.aac_channels = (this.codec.aac_sample_rate >> 3) & 0x0f;
        this.codec.aac_sample_rate = ((this.codec.aac_profile << 1) & 0x0e) | ((this.codec.aac_sample_rate >> 7) & 0x01);
        this.codec.aac_profile = (this.codec.aac_profile >> 3) & 0x1f;
        this.codec.audiosamplerate = aac_sample_rates[this.codec.aac_sample_rate];
        if (this.codec.aac_profile == 0 || this.codec.aac_profile == 0x1f) {
          this.emit('error', new Error('Parse audio aac sequence header failed,' +
            ` adts object=${this.codec.aac_profile} invalid`));
          return -1;
        }
        this.codec.aac_profile--;
        // console.info("Parse audio aac sequence header success! ");
        // console.info(this.codec);
        this.isFirstAudioReceived = false;
        this.emit('audio-ready', rtmpBody);
      }

    } else {
      this.emit('audio', rtmpHeader, rtmpBody);
    }
  }

  parseVideoMessage(rtmpHeader, rtmpBody) {
    var index = 0;
    var frame_type = rtmpBody[0];
    var codec_id = frame_type & 0x0f;
    frame_type = (frame_type >> 4) & 0x0f;
    // only support h.264/avc
    if (codec_id != 7) {
      this.emit('error', new Error(`Only support video h.264/avc codec. actual=${codec_id}`));
      return -1;
    }
    var avc_packet_type = rtmpBody[1];
    var composition_time = rtmpBody.readIntBE(2, 3);
    //  printf("v composition_time %d\n",composition_time);
    if (avc_packet_type == 0) {
      if (this.isFirstVideoReceived) {
        //AVC sequence header
        var configurationVersion = rtmpBody[5];
        this.codec.avc_profile = rtmpBody[6];
        var profile_compatibility = rtmpBody[7];
        this.codec.avc_level = rtmpBody[8];
        var lengthSizeMinusOne = rtmpBody[9];
        lengthSizeMinusOne &= 0x03;
        this.codec.NAL_unit_length = lengthSizeMinusOne;
        //  sps
        var numOfSequenceParameterSets = rtmpBody[10];
        numOfSequenceParameterSets &= 0x1f;

        if (numOfSequenceParameterSets != 1) {
          this.emit('error', new Error('Decode video avc sequenc header sps failed'));
          return -1;
        }
        this.codec.spsLen = rtmpBody.readUInt16BE(11);
        index = 11 + 2;
        if (this.codec.spsLen > 0) {
          this.codec.sps = Buffer.alloc(this.codec.spsLen);
          rtmpBody.copy(this.codec.sps, 0, 13, 13 + this.codec.spsLen);
        }
        // pps
        index += this.codec.spsLen;
        var numOfPictureParameterSets = rtmpBody[index];
        numOfPictureParameterSets &= 0x1f;
        if (numOfPictureParameterSets != 1) {
          this.emit('error', new Error('Decode video avc sequenc header pps failed.'));
          return -1;
        }
        index++;
        this.codec.ppsLen = rtmpBody.readUInt16BE(index);
        index += 2;
        if (this.codec.ppsLen > 0) {
          this.codec.pps = Buffer.alloc(this.codec.ppsLen);
          rtmpBody.copy(this.codec.pps, 0, index, index + this.codec.ppsLen);
        }
        this.isFirstVideoReceived = false;
        // console.info("Parse video avc sequence header success! ");
        // console.info(this.codec);
        // console.info('sps: ' + this.codec.sps.hex());
        // console.info('pps: ' + this.codec.pps.hex());
        this.emit('video-ready', rtmpBody);
      }
    } else if (avc_packet_type == 1) {
      this.emit('video', rtmpHeader, rtmpBody);
    } else {
      //AVC end of sequence (lower level NALU sequence ender is not required or supported)
    }
  }

  sendRtmpMessage() {
    if (!this.isStarting) return;
    var len = this.sendBufferQueue.length;
    for (var i = 0; i < len; i++) {
      this.socket.write(this.sendBufferQueue.shift());
    };
    setTimeout(() => this.sendRtmpMessage(), 200);
  }


  windowACK(size) {
    var rtmpBuffer = Buffer.from('02000000000004050000000000000000', 'hex');
    rtmpBuffer.writeUInt32BE(size, 12);
    // console.log('windowACK: '+rtmpBuffer.hex());
    this.socket.write(rtmpBuffer);
  }

  setPeerBandwidth(size, type) {
    var rtmpBuffer = Buffer.from('0200000000000506000000000000000000', 'hex');
    rtmpBuffer.writeUInt32BE(size, 12);
    rtmpBuffer[16] = type;
    // console.log('setPeerBandwidth: '+rtmpBuffer.hex());
    this.socket.write(rtmpBuffer);
  }

  setChunkSize(size) {
    var rtmpBuffer = Buffer.from('02000000000004010000000000000000', 'hex');
    rtmpBuffer.writeUInt32BE(size, 12);
    // console.log('setChunkSize: '+rtmpBuffer.hex());
    this.socket.write(rtmpBuffer);
  }

  respondConnect() {
    var rtmpHeader = {
      chunkStreamID: 3,
      timestamp: 0,
      messageTypeID: 0x14,
      messageStreamID: 0
    };
    var opt = {
      cmd: '_result',
      transId: 1,
      cmdObj: {
        fmsVer: 'FMS/3,0,1,123',
        capabilities: 31
      },
      info: {
        level: 'status',
        code: 'NetConnection.Connect.Success',
        description: 'Connection succeeded.',
        objectEncoding: this.objectEncoding
      }
    };
    var rtmpBody = AMF.encodeAmf0Cmd(opt);
    var rtmpMessage = Packet.create(rtmpHeader, rtmpBody).toBuffer();
    this.socket.write(rtmpMessage);
  }

  respondRejectConnect() {
    var rtmpHeader = {
      chunkStreamID: 3,
      timestamp: 0,
      messageTypeID: 0x14,
      messageStreamID: 0
    };

    var opt = {
      cmd: '_error',
      transId: 1,
      cmdObj: {
        fmsVer: 'FMS/3,0,1,123',
        capabilities: 31
      },
      info: {
        level: 'error',
        code: 'NetConnection.Connect.Rejected',
        description: 'Connection failed.',
        objectEncoding: this.objectEncoding
      }
    };
    var rtmpBody = AMF.encodeAmf0Cmd(opt);
    var rtmpMessage = Packet.create(rtmpHeader, rtmpBody).toBuffer();
    this.socket.write(rtmpMessage);
  }

  respondCreateStream(cmd) {
    var rtmpHeader = {
      chunkStreamID: 3,
      timestamp: 0,
      messageTypeID: 0x14,
      messageStreamID: 0
    };
    var opt = {
      cmd: "_result",
      transId: cmd.transId,
      cmdObj: null,
      info: 1

    };
    var rtmpBody = AMF.encodeAmf0Cmd(opt);
    var rtmpMessage = Packet.create(rtmpHeader, rtmpBody).toBuffer();
    this.socket.write(rtmpMessage);

  }


  closeStream() {

  }

  deleteStream() {

  }

  pauseOrUnpauseStream() {

  }

  respondReleaseStream() {

  }

  respondFCPublish() {

  }

  respondPublish() {
    var rtmpHeader = {
      chunkStreamID: 5,
      timestamp: 0,
      messageTypeID: 0x14,
      messageStreamID: 1
    };
    var opt = {
      cmd: 'onStatus',
      transId: 0,
      cmdObj: null,
      info: {
        level: 'status',
        code: 'NetStream.Publish.Start',
        description: 'Start publishing'
      }
    };
    var rtmpBody = AMF.encodeAmf0Cmd(opt);
    var rtmpMessage = Packet.create(rtmpHeader, rtmpBody).toBuffer();
    this.socket.write(rtmpMessage);

  }


  sendStreamEOF() {
    var rtmpBuffer = Buffer.alloc("020000000000060400000000000100000001", 'hex');
    this.socket.write(rtmpBuffer);
  }

  respondPublishError() {
    var rtmpHeader = {
      chunkStreamID: 5,
      timestamp: 0,
      messageTypeID: 0x14,
      messageStreamID: 1
    };
    var opt = {
      cmd: 'onStatus',
      transId: 0,
      cmdObj: null,
      info: {
        level: 'error',
        code: 'NetStream.Publish.BadName',
        description: 'Already publishing'
      }
    };
    var rtmpBody = AMF.encodeAmf0Cmd(opt);
    var rtmpMessage = Packet.create(rtmpHeader, rtmpBody).toBuffer();
    this.socket.write(rtmpMessage);
  }

  respondFCUnpublish() {

  }

  respondPlay() {
    var rtmpHeader = {
      chunkStreamID: 3,
      timestamp: 0,
      messageTypeID: 0x14,
      messageStreamID: 1
    };
    var opt = {
      cmd: 'onStatus',
      transId: 0,
      cmdObj: null,
      info: {
        level: 'status',
        code: 'NetStream.Play.Start',
        description: 'Start live'
      }
    };
    var rtmpBody = AMF.encodeAmf0Cmd(opt);
    var rtmpMessage = Packet.create(rtmpHeader, rtmpBody).toBuffer();
    this.socket.write(rtmpMessage);

    var rtmpHeader = {
      chunkStreamID: 5,
      timestamp: 0,
      messageTypeID: 0x12,
      messageStreamID: 1
    };
    var opt = {
      cmd: '|RtmpSampleAccess',
      bool1: true,
      bool2: true
    };

    var rtmpBody = AMF.encodeAmf0Cmd(opt);
    var rtmpMessage = Packet.create(rtmpHeader, rtmpBody).toBuffer();
    this.socket.write(rtmpMessage);
  }
}

module.exports = Connection;
