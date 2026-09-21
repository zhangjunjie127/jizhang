import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendGesture, checkCredential, createCredential, emptyLock, failedAttempt, parseLock, validSecret } from '../src/app-lock-core.mjs';

test('PIN and pattern use salted, mode-separated hashes; no plaintext stored', async () => {
  const first = await createCredential('pin', '123456');
  const second = await createCredential('pin', '123456');
  assert.notEqual(first.hash, second.hash);
  assert.notEqual(first.salt, second.salt);
  assert.ok(!JSON.stringify(first).includes('123456'));
  assert.equal(await checkCredential('pin', '123456', first), true);
  assert.equal(await checkCredential('pin', '123455', first), false);
  const gesture = await createCredential('gesture', '123456');
  assert.equal(await checkCredential('gesture', '123456', gesture), true);
  assert.equal(await checkCredential('pin', '123456', gesture), false);
  for (const value of ['12345', '1234567', 'abcdef']) assert.equal(validSecret('pin', value), false);
  for (const value of ['012', '0122', '0193']) assert.equal(validSecret('gesture', value), false);
});
test('missing settings start disabled, corrupt or inconsistent settings fail closed', async () => {
  assert.deepEqual(parseLock(null), emptyLock());
  const pin = await createCredential('pin', '654321');
  const value = { ...emptyLock(), enabled: true, pin };
  assert.deepEqual(parseLock(JSON.stringify(value)), value);
  for (const raw of ['undefined', '{}', 'null', JSON.stringify({ ...emptyLock(), enabled: true }),
    JSON.stringify({ ...value, pin: { ...pin, iterations: 1 } }),
    JSON.stringify({ ...value, blockedUntil: -1 }), JSON.stringify({ ...value, failures: 6 })]) assert.throws(() => parseLock(raw));
});
test('five failures cause a persistent cooldown', () => {
  let config = emptyLock();
  for (let index = 0; index < 5; index++) config = failedAttempt(config, 1000);
  assert.equal(config.failures, 0);
  assert.equal(config.blockedUntil, 61000);
  assert.equal(parseLock(JSON.stringify(config)).blockedUntil, 61000);
});
test('gesture inserts untouched midpoints once and ignores repeats', () => {
  assert.equal(appendGesture('0', 2), '012');
  assert.equal(appendGesture('0', 8), '048');
  assert.equal(appendGesture('4', 4), '4');
  assert.equal(appendGesture('140', 8), '1408');
  assert.equal(appendGesture('0', 7), '07');
  assert.equal(appendGesture('0', 9), '0');
});
