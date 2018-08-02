const EventEmitter = require('events');

class RTMP extends EventEmitter {

}

RTMP.Server = require('./server');
RTMP.createServer = function(options){
  return new RTMP.Server(options);
};

module.exports = RTMP;