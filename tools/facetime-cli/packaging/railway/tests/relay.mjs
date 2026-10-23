// Synthetic transport handshake only. Never a Chert authority or real backend.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { WebSocketServer } from '/opt/chert-pilot/railway-20260930-r1/node_modules/ws/wrapper.mjs';
const scope = JSON.parse(readFileSync('/state/chert-pilot/connector/config.json')).transport.scope;
let generation = 0;
const server = createServer((req,res) => { res.writeHead(503); res.end('{}'); });
const wss = new WebSocketServer({noServer:true});
server.on('upgrade', (req,socket,head) => {
  if (req.url !== '/connect' || req.headers.authorization !== 'Bearer synthetic-connection') return socket.destroy();
  wss.handleUpgrade(req,socket,head,ws => ws.send(JSON.stringify({...scope,connection_generation:++generation,
    v:1,type:'connection.welcome',message_id:'welcome',role:'standby'})));
});
server.listen(9091,'127.0.0.1');
