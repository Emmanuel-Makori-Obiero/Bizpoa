import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/storage.js';
import { recordVoiceTransaction } from '../src/voice.js';

async function makeStore(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bizpoa-voice-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = createStore(path.join(directory, 'db.json'));
  await store.transact((database) => {
    database.businesses['+254700000001'] = {
      code: 'BZ-ABC123', name: 'Amina Shop', phoneNumber: '+254700000001',
    };
  });
  return store;
}

test('voice demo records a transaction against an existing business', async (t) => {
  const store = await makeStore(t);
  const result = await recordVoiceTransaction({ businessCode: 'bz-abc123', type: 'sale', amount: 300.5 }, store);

  assert.equal(result.ok, true);
  assert.equal(result.transaction.businessCode, 'BZ-ABC123');
  assert.equal(result.transaction.phoneNumber, '+254700000001');
  assert.equal(result.transaction.type, 'sale');
  assert.equal(result.transaction.amount, 300.5);
  assert.match(result.transaction.id, /^[0-9a-f-]{36}$/i);
  await store.read((database) => assert.equal(database.transactions.length, 1));
});

test('voice demo rejects unsupported types and invalid amounts', async (t) => {
  const store = await makeStore(t);
  assert.deepEqual(await recordVoiceTransaction({ businessCode: 'BZ-ABC123', type: 'refund', amount: 20 }, store), {
    ok: false, reason: 'invalid_type',
  });
  assert.deepEqual(await recordVoiceTransaction({ businessCode: 'BZ-ABC123', type: 'expense', amount: 0 }, store), {
    ok: false, reason: 'invalid_amount',
  });
  assert.deepEqual(await recordVoiceTransaction({ businessCode: 'BZ-ABC123', type: 'expense', amount: 1.001 }, store), {
    ok: false, reason: 'invalid_amount',
  });
  await store.read((database) => assert.equal(database.transactions.length, 0));
});

test('voice demo rejects unknown business IDs without changing records', async (t) => {
  const store = await makeStore(t);
  assert.deepEqual(await recordVoiceTransaction({ businessCode: 'BZ-XXXXXX', type: 'expense', amount: 40 }, store), {
    ok: false, reason: 'unknown_business',
  });
  await store.read((database) => assert.equal(database.transactions.length, 0));
});
