import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { OnboardError } from './onboard.js';

/** A fixed installed entry point, never a server-supplied command or callback. */
export function scheduleHelperExpiry(file:string):Promise<void>{
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[fileURLToPath(new URL('./expiry-cli.js',import.meta.url)),file],{detached:true,cwd:tmpdir(),env:{},stdio:['ignore','ignore','ignore','ipc']});
    const fail=()=>{clearTimeout(timer);child.kill();reject(new OnboardError('Automatic helper cleanup could not start.'));};
    const timer=setTimeout(fail,5000);
    child.once('error',fail);child.once('exit',fail);
    child.once('message',message=>{
      if(!message||typeof message!=='object'||!('type' in message)||message.type!=='expiry-ready'){fail();return;}
      clearTimeout(timer);child.removeListener('error',fail);child.removeListener('exit',fail);
      if(child.connected)child.disconnect();child.unref();resolve();
    });
  });
}
