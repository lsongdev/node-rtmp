# RTMP-Server

A Node.js implementation of RTMP Server 
 - Supports only RTMP protocol.
 - Supports only H.264 video and AAC audio.
 
# Install

```bash
npm install --save rtmp2
```
 
# Usage 
```js
const RTMP = require('rtmp2');

const rtmpServer = RTMP.createServer();

rtmpServer.on('client', client => {
  client.on('command', command => {
  //  console.log(command.cmd, command);
  });

  client.on('connect', () => {
     console.log('connect', client.app);
  });
  
  client.on('play', ({ streamName }) => {
    console.log('PLAY', streamName);
  });
  
  client.on('publish', ({ streamName }) => {
    console.log('PUBLISH', streamName);
  });
  
  client.on('stop', () => {
    console.log('client disconnected');
  });
});

rtmpServer.listen(1935);
```

You can now publish streams to `rtmp://localhost:1935/live/mytv` and use any unique stream key.

```bash
~$ ffmpeg -f avfoundation -i "1" -vcodec libx264 -f flv rtmp://localhost:1935/live/mytv
```

The stream will then be available at `rtmp://localhost:1935/live/mytv`.

# License

This project is under MIT license.
