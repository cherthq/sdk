import { reapExpiredOnboarding } from './onboard.js';

// Detached local cleanup only: no network, provider calls, shell commands or credential output.
try{
  if(process.argv.length!==3)throw new Error('Invalid expiry invocation');
  const result=await reapExpiredOnboarding(process.argv[2]!,{emit:()=>{if(process.connected)process.send?.({type:'expiry-ready'});}});
  if(result.status==='cleanup_blocked')process.exitCode=1;
}catch{process.exitCode=1;}
