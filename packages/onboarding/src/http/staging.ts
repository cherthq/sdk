import { readStagingConfig, StagingConfigError } from './staging-config';
import { startStagingHost } from './staging-host';

try {
  const args=process.argv.slice(2);
  if(args.length>1||(args.length===1&&args[0]!=='--check-config'))throw new Error('Unsupported staging command');
  const config = readStagingConfig(process.env);
  if (process.argv.includes('--check-config')) {
    console.log(JSON.stringify({ status: 'configured', mode: 'staging', recipientCount: config.recipients.length, billing: 'stripe-test', productionReady: false }));
  } else {
    const host = await startStagingHost(config, { onDispatcherError: () => { console.error('Staging dispatcher failed; inspect durable work without logging secrets.'); } });
    console.log(`Chert staging host listening on loopback port ${host.server.port}; HTTPS proxy required. No contact or checkout acceptance is implied.`);
    const close = () => { void host.close().then(() => process.exit(0),()=>{console.error('Staging shutdown could not finish cleanly.');process.exit(1);}); };
    process.on('SIGINT', close); process.on('SIGTERM', close);
  }
} catch (error) {
  console.error(error instanceof StagingConfigError ? error.message : 'Staging host could not start. Check configuration, data permissions and listener availability.');
  process.exitCode = 1;
}
