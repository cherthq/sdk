import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { stopOnSignals } from '../../src/dev/signals.js';

function fakeProcess() { const emitter = new EventEmitter(); const exits: number[] = []; return Object.assign(emitter, { exit: (code: number) => { exits.push(code); }, exits }); }

test('signals: the first Ctrl+C requests a stop and says the line is being released', () => {
  const proc = fakeProcess(); const controller = new AbortController(); const messages: string[] = [];
  const remove = stopOnSignals(controller, record => messages.push(String(record.code)), proc);
  proc.emit('SIGINT');
  assert.equal(controller.signal.aborted, true); assert.deepEqual(messages, ['stopping']); assert.deepEqual(proc.exits, []);
  remove();
});

test('signals: a second Ctrl+C does not kill the process before the line is released', () => {
  const proc = fakeProcess(); const controller = new AbortController(); const messages: string[] = [];
  const remove = stopOnSignals(controller, record => messages.push(String(record.code)), proc);
  proc.emit('SIGINT'); proc.emit('SIGINT');
  assert.deepEqual(messages, ['stopping', 'still_stopping']); assert.deepEqual(proc.exits, []);
  remove();
});

test('signals: a third Ctrl+C is honoured as a forced exit', () => {
  const proc = fakeProcess(); const controller = new AbortController();
  const remove = stopOnSignals(controller, () => {}, proc);
  proc.emit('SIGINT'); proc.emit('SIGTERM'); proc.emit('SIGINT');
  assert.deepEqual(proc.exits, [130]);
  remove();
});

test('signals: listeners are removed afterwards', () => {
  const proc = fakeProcess(); const controller = new AbortController();
  stopOnSignals(controller, () => {}, proc)();
  assert.equal(proc.listenerCount('SIGINT'), 0); assert.equal(proc.listenerCount('SIGTERM'), 0);
});

test('signals: a closed terminal (SIGHUP) requests the same stop as the first Ctrl+C', () => {
  const proc = fakeProcess(); const controller = new AbortController(); const messages: string[] = [];
  const remove = stopOnSignals(controller, record => messages.push(String(record.code)), proc);
  proc.emit('SIGHUP');
  assert.equal(controller.signal.aborted, true); assert.deepEqual(messages, ['stopping']); assert.deepEqual(proc.exits, []);
  remove();
  assert.equal(proc.listenerCount('SIGHUP'), 0);
});

test('signals: after a hangup, a write error on the vanished terminal cannot crash the release', () => {
  const stdout = new EventEmitter(), stderr = new EventEmitter();
  const proc = Object.assign(fakeProcess(), { stdout, stderr }); const controller = new AbortController(); const messages: string[] = [];
  const remove = stopOnSignals(controller, record => messages.push(String(record.code)), proc);
  proc.emit('SIGHUP');
  assert.doesNotThrow(() => { stdout.emit('error', Object.assign(new Error('write EIO'), { code: 'EIO' })); stderr.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })); });
  assert.deepEqual(messages, ['stopping'], 'the terminal going away counts once');
  remove();
  assert.doesNotThrow(() => stdout.emit('error', new Error('write EIO')), 'a write after the session still cannot crash it');
});

test('signals: output that can no longer be written (terminal gone before its hangup, or the pipe reader exited) starts the same release', () => {
  const stdout = new EventEmitter(), stderr = new EventEmitter();
  const proc = Object.assign(fakeProcess(), { stdout, stderr }); const controller = new AbortController(); const messages: string[] = [];
  const remove = stopOnSignals(controller, record => messages.push(String(record.code)), proc);
  assert.doesNotThrow(() => stdout.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })));
  assert.equal(controller.signal.aborted, true);
  proc.emit('SIGHUP');
  assert.deepEqual(messages, ['stopping'], 'a write error and the hangup that follows are one stop');
  assert.deepEqual(proc.exits, []);
  remove();
});

test('signals: Ctrl+C still counts after the terminal went away, and a third stop forces the exit', () => {
  const stdout = new EventEmitter();
  const proc = Object.assign(fakeProcess(), { stdout }); const controller = new AbortController();
  const remove = stopOnSignals(controller, () => {}, proc);
  proc.emit('SIGHUP'); stdout.emit('error', new Error('write EIO')); proc.emit('SIGTERM');
  assert.deepEqual(proc.exits, []);
  proc.emit('SIGTERM');
  assert.deepEqual(proc.exits, [130]);
  remove();
});

test('signals: without a lost terminal, removing the listeners leaves the output streams as they were', () => {
  const stdout = new EventEmitter(), stderr = new EventEmitter();
  const proc = Object.assign(fakeProcess(), { stdout, stderr });
  stopOnSignals(new AbortController(), () => {}, proc)();
  assert.equal(stdout.listenerCount('error'), 0); assert.equal(stderr.listenerCount('error'), 0);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) assert.equal(proc.listenerCount(signal), 0);
});
