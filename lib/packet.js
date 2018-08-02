class Packet {
  static parse(buffer) {
    const packet = new Packet();
    return packet;
  }
  static create(header, payload) {
    const packet = new Packet(header, payload);
    if (typeof header === 'object') {
      for (const k in header) {
        packet[k] = header[k];
      }
    }
    return packet;
  }
  constructor(header, payload) {
    this.header = Object.assign({
      fmt: 0,
      cid: 0,
      type: 0,
      stream_id: 0,
      timestamp: 0,
    }, header);
    Object.assign(this, {
      clock: 0,
      delta: 0,
      bytes: 0,
      payload,
      capacity: 0,
    });
    return this;
  }
  get length() {
    return this.payload.length;
  }
  get messageTypeID() {
    return this.header.type;
  }
  set messageTypeID(type) {
    this.header.type = type;
    return this;
  }
  get chunkStreamID() {
    return this.header.cid;
  }
  set chunkStreamID(cid) {
    this.header.cid = cid;
    return this;
  }
  get channel() {
    return this.header.cid;
  }
  set channel(cid) {
    this.header.cid = cid;
    return this;
  }
  get messageStreamID() {
    return this.header.stream_id;
  }
  set messageStreamID(sid) {
    this.header.stream_id = sid;
    return this;
  }
  get timestamp() {
    return this.header.timestamp;
  }
  set timestamp(timestamp) {
    this.header.timestamp = timestamp;
    return this;
  }
  toBuffer({ chunkSize = 4096 } = {}) {
    const { header, payload } = this;
    var rtmpBodySize = payload.length;
    var timestamp, useExtendedTimestamp = false;
    if (header.timestamp >= 0xffffff) {
      useExtendedTimestamp = true;
      timestamp = [0xff, 0xff, 0xff];
    } else {
      timestamp = [
        (header.timestamp >> 16) & 0xff,
        (header.timestamp >> 8) & 0xff,
        (header.timestamp >> 0) & 0xff
      ];
    }

    var bufs = Buffer.from([
      (header.fmt << 6) | header.cid,
      timestamp[0], 
      timestamp[1],
      timestamp[2],
      (rtmpBodySize >> 16) & 0xff, 
      (rtmpBodySize >> 8) & 0xff,
      rtmpBodySize & 0xff,
      header.type, 
      header.stream_id & 0xff,
      (header.stream_id >>> 8) & 0xff, 
      (header.stream_id >>> 16) & 0xff, 
      (header.stream_id >>> 24) & 0xff
    ]);

    if (useExtendedTimestamp) {
      var extendedTimestamp = Buffer.from([
        (header.timestamp >> 24) & 0xff, 
        (header.timestamp >> 16) & 0xff, 
        (header.timestamp >> 8) & 0xff, 
        header.timestamp & 0xff
      ]);
      bufs = Buffer.concat([bufs, extendedTimestamp]);
    }


    var rtmpBodyPos = 0;
    var chunkBody = [];
    var type3Header = Buffer.from([
      (3 << 6) | header.cid
    ]);

    do {
      if (rtmpBodySize > chunkSize) {
        chunkBody.push(payload.slice(rtmpBodyPos, rtmpBodyPos + chunkSize));
        rtmpBodySize -= chunkSize
        rtmpBodyPos += chunkSize;
        chunkBody.push(type3Header);
      } else {
        chunkBody.push(payload.slice(rtmpBodyPos, rtmpBodyPos + rtmpBodySize));
        rtmpBodySize -= rtmpBodySize;
        rtmpBodyPos += rtmpBodySize;
      }

    } while (rtmpBodySize > 0)
    var chunkBodyBuffer = Buffer.concat(chunkBody);
    bufs = Buffer.concat([bufs, chunkBodyBuffer]);
    return bufs;
  }
}

Packet.TYPES = {
  AUDIO: 0x08,
  VIDEO: 0x09,
};

Packet.CHANNELS = {
  PROTOCOL: 2,
  INVOKE: 3,
  AUDIO: 4,
  VIDEO: 5,
  DATA: 6,
};

Packet.CHUNKS = {
  TYPE_0: 0, // 11-bytes: timestamp(3) + length(3) + stream type(1) + stream id(4)
  TYPE_1: 1, // 7-bytes: delta(3) + length(3) + stream type(1)
  TYPE_2: 2, // 3-bytes: delta(3)
  TYPE_3: 3, // 0-byte
};

module.exports = Packet;