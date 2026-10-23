import { copyFileSync, constants, chmodSync } from 'node:fs';
import { loadConfig } from '../node_modules/chert-local-transport-proof/dist/src/cli/config.js';
import { ByorJournal } from '../node_modules/chert-local-transport-proof/dist/src/byor/journal.js';
const initialize = process.argv[2] === 'initialize';
const destination = '/state/chert-pilot/connector/config.json';
const config = loadConfig(initialize ? '/bootstrap/config.json' : destination);
if (config.schema_version !== 2 || config.mode !== 'byor' ||
    config.state_dir !== '/state/chert-pilot/connector' ||
    config.handler.id !== 'talking-head-ready-v1' ||
    config.handler.module !== '/opt/chert-pilot/railway-20260930-r1/handler/handler.js' ||
    config.transport.mode === 'unconfigured' ||
    config.transport.credential_env !== 'CHERT_CONNECTION_TOKEN' ||
    config.transport.recovery_env !== 'CHERT_RECOVERY_TOKEN' ||
    config.transport.credentials_file !== undefined) throw new Error('fixed_configuration_required');
if (initialize) {
  copyFileSync('/bootstrap/config.json', destination, constants.COPYFILE_EXCL);
  chmodSync(destination, 0o600);
  new ByorJournal(config.transport.scope, config.handler, config.state_dir + '/journal.json').close();
}
