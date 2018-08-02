const AMF = require('./amf');
const Packet = require('./packet');
const Handshake = require('./handshake');
const EventEmitter = require('events');

class Protocol extends EventEmitter {
  constructor(){
    super();
    this.previousChunkMessage = {};
  }

  getRealChunkSize(rtmpBodySize, chunkSize) {
    var nn = rtmpBodySize + parseInt(rtmpBodySize / chunkSize);
    if (rtmpBodySize % chunkSize) {
      return nn;
    } else {
      return nn - 1;
    }
  }
  *parseRtmpMessage(self) {
    console.log("rtmp handshake [start]");
    if (self.bp.need(1537)) {
      yield;
    }
    var c0c1 = self.bp.read(1537);
    var s0s1s2 = Handshake.generateS0S1S2(c0c1);
    self.socket.write(s0s1s2);
    if (self.bp.need(1536)) {
      yield;
    }
    var c2 = self.bp.read(1536);
    console.log("rtmp handshake [ok]", c2);

    while (self.isStarting) {
      var message = {};
      var chunkMessageHeader = null;
      var previousChunk = null;
      var pos = 0;
      if (self.bp.need(1)) {
        yield;
      }
      var chunkBasicHeader = self.bp.read(1);
      message.formatType = chunkBasicHeader[0] >> 6;
      message.chunkStreamID = chunkBasicHeader[0] & 0x3F;
      if (message.chunkStreamID == 0) {
        if (self.bp.need(1)) {
          yield;
        }
        var exStreamID = self.bp.read(1);
        message.chunkStreamID = exStreamID[0] + 64;
      } else if (message.chunkStreamID == 1) {
        if (self.bp.need(2)) {
          yield;
        }
        var exStreamID = self.bp.read(2);
        message.chunkStreamID = (exStreamID[0] << 8) + exStreamID[1] + 64;
      }

      if (message.formatType == 0) {
        // Type 0 (11 bytes)
        if (self.bp.need(11)) {
          yield;
        }
        chunkMessageHeader = self.bp.read(11);
        message.timestamp = chunkMessageHeader.readIntBE(0, 3);
        message.timestampDelta = 0;
        message.messageLength = chunkMessageHeader.readIntBE(3, 3);
        message.messageTypeID = chunkMessageHeader[6];
        message.messageStreamID = chunkMessageHeader.readInt32LE(7);
      } else if (message.formatType == 1) {
        // Type 1 (7 bytes)
        if (self.bp.need(7)) {
          yield;
        }
        chunkMessageHeader = self.bp.read(7);
        message.timestampDelta = chunkMessageHeader.readIntBE(0, 3);
        message.messageLength = chunkMessageHeader.readIntBE(3, 3);
        message.messageTypeID = chunkMessageHeader[6]
        previousChunk = self.previousChunkMessage[message.chunkStreamID];
        if (previousChunk != null) {
          message.timestamp = previousChunk.timestamp;
          message.messageStreamID = previousChunk.messageStreamID;
        } else {
          throw new Error("Chunk reference error for type 1: previous chunk for id " + message.chunkStreamID + " is not found");
        }
      } else if (message.formatType == 2) {
        // Type 2 (3 bytes)
        if (self.bp.need(3)) {
          yield;
        }
        chunkMessageHeader = self.bp.read(3);
        message.timestampDelta = chunkMessageHeader.readIntBE(0, 3);
        previousChunk = self.previousChunkMessage[message.chunkStreamID];
        if (previousChunk != null) {
          message.timestamp = previousChunk.timestamp
          message.messageStreamID = previousChunk.messageStreamID
          message.messageLength = previousChunk.messageLength
          message.messageTypeID = previousChunk.messageTypeID
        } else {
          throw new Error("Chunk reference error for type 2: previous chunk for id " + message.chunkStreamID + " is not found");
        }
      } else if (message.formatType == 3) {
        // Type 3 (0 byte)
        previousChunk = self.previousChunkMessage[message.chunkStreamID];
        if (previousChunk != null) {
          message.timestamp = previousChunk.timestamp;
          message.messageStreamID = previousChunk.messageStreamID;
          message.messageLength = previousChunk.messageLength;
          message.timestampDelta = previousChunk.timestampDelta;
          message.messageTypeID = previousChunk.messageTypeID;
        } else {
          throw new Error("Chunk reference error for type 3: previous chunk for id " + message.chunkStreamID + " is not found");
        }
      } else {
        throw new Error("Unknown format type: " + message.formatType);
      }

      //Extended Timestamp
      if (message.formatType === 0) {
        if (message.timestamp === 0xffffff) {
          if (self.bp.need(4)) {
            yield;
          }
          var chunkBodyHeader = self.bp.read(4);
          message.timestamp = (chunkBodyHeader[0] * Math.pow(256, 3)) + (chunkBodyHeader[1] << 16) + (chunkBodyHeader[2] << 8) + chunkBodyHeader[3];
        }
      } else if (message.timestampDelta === 0xffffff) {
        if (self.bp.need(4)) {
          yield;
        }
        var chunkBodyHeader = self.bp.read(4);
        message.timestampDelta = (chunkBodyHeader[0] * Math.pow(256, 3)) + (chunkBodyHeader[1] << 16) + (chunkBodyHeader[2] << 8) + chunkBodyHeader[3];
      }

      // console.log(message);

      var rtmpBody = [];
      var rtmpBodySize = message.messageLength;
      var chunkBodySize = self.getRealChunkSize(rtmpBodySize, self.inChunkSize);
      if (self.bp.need(chunkBodySize)) {
        yield;
      }
      var chunkBody = self.bp.read(chunkBodySize);
      var chunkBodyPos = 0;
      do {
        if (rtmpBodySize > self.inChunkSize) {
          rtmpBody.push(chunkBody.slice(chunkBodyPos, chunkBodyPos + self.inChunkSize));
          rtmpBodySize -= self.inChunkSize;
          chunkBodyPos += self.inChunkSize;
          chunkBodyPos++;
        } else {
          rtmpBody.push(chunkBody.slice(chunkBodyPos, chunkBodyPos + rtmpBodySize));
          rtmpBodySize -= rtmpBodySize;
          chunkBodyPos += rtmpBodySize;
        }

      } while (rtmpBodySize > 0);

      message.timestamp += message.timestampDelta;
      self.previousChunkMessage[message.chunkStreamID] = message;
      var rtmpBodyBuf = Buffer.concat(rtmpBody);
      self.emit('message', message, rtmpBodyBuf);
    }
  }

}

module.exports = Protocol;