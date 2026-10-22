#!/usr/bin/env node
import { ChertApiError } from '@cherthq/control-plane';
import { OnboardError } from './onboard.js';
import { scheduleHelperExpiry } from './expiry.js';
import { run, SetupError } from './main.js';

const json = process.argv.includes('--json');
function output(value: Record<string, unknown>): void {
  if (json) console.log(JSON.stringify(value));
  else if (typeof value.text === 'string') console.log(value.text);
  else console.log(JSON.stringify(value, null, 2));
}
try {
  const result = await run(process.argv.slice(2), { emit: output, scheduleExpiry: scheduleHelperExpiry });
  output(result);
  if (result.status === 'blocked') process.exitCode = 2;
} catch (error) {
  // Server response bodies and runtime errors may contain credentials; never print them.
  output({ status: 'error', message: (error instanceof SetupError || error instanceof OnboardError) ? error.message : error instanceof ChertApiError ? `Chert API refused this step (${error.status}, ${error.code}). Check access and backend availability; no connection is claimed.` : 'Chert could not complete this step. Check the backend and local file permissions. Nothing is claimed to be connected.' });
  process.exitCode = 1;
}
