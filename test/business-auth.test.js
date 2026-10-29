import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/storage.js';
import { createOwnerOtp, normalizePhoneNumber, verifyOwnerOtp, verifyOwnerSessionToken } from '../src/business-auth.js';

async function makeStore(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bizpoa-owner-auth-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = createStore(path.join(directory, 'db.json'));
  await store.transact((database) => {
    database.businesses['+254700000001'] = {
      code: 'BZ-ABC123', name: 'Amina Shop', phoneNumber: '+254700000001',
    };
    database.businesses['+254700000002'] = {
      code: 'BZ-DEF456', name: 'Other Shop', phoneNumber: '+254700000002',
    };
  });
  return store;
}

const secret = 'owner-session-signing-secret-for-tests-123456';
const now = Date.parse('2026-10-29T12:00:00Z');

 test('owner OTP requires the exact Bizpoa ID and registered phone, then gives only that business a session', async (t) => {
  const store = await makeStore(t);
  const requested = await createOwnerOtp({ businessCode: 'bz-abc123', phoneNumber: '0700000001' }, {
    store, env: { BIZPOA_OWNER_SESSION_SECRET: secret }, now, createCode: () => '123456',
  });
  assert.equal(requested.ok, true);
  assert.deepEqual(requested.business, { code: 'BZ-ABC123', name: 'Amina Shop' });
  assert.equal(requested.phoneNumber, '+254700000001');
  assert.equal((await store.read((database) => database.ownerOtpChallenges['BZ-ABC123:+254700000001'].codeHash)).length, 64);

  const verified = await verifyOwnerOtp({ businessCode: 'BZ-ABC123', phoneNumber: '+254700000001', code: '123456' }, {
    store, env: { BIZPOA_OWNER_SESSION_SECRET: secret }, now: now + 1000,
  });
  assert.equal(verified.ok, true);
  assert.equal(verifyOwnerSessionToken(verified.accessToken, secret, now + 2000).businessCode, 'BZ-ABC123');
  assert.equal(verifyOwnerSessionToken(verified.accessToken, secret, now + 13 * 60 * 60 * 1000), null);
  assert.equal(verifyOwnerSessionToken(`${verified.accessToken}x`, secret, now + 2000), null);
  assert.deepEqual(await createOwnerOtp({ businessCode: 'BZ-ABC123', phoneNumber: '+254700000001' }, {
    store, env: { BIZPOA_OWNER_SESSION_SECRET: secret }, now: now + 2000, createCode: () => '222222',
  }), { ok: false, reason: 'rate_limited' });
  assert.equal(await store.read((database) => Object.keys(database.ownerOtpChallenges).length), 0);
});

test('owner OTP does not disclose or authorize another business and rejects expired or incorrect codes', async (t) => {
  const store = await makeStore(t);
  const mismatch = await createOwnerOtp({ businessCode: 'BZ-ABC123', phoneNumber: '+254700000002' }, {
    store, env: { BIZPOA_OWNER_SESSION_SECRET: secret }, now, createCode: () => '333333',
  });
  assert.deepEqual(mismatch, { ok: false, reason: 'owner_not_found' });

  await createOwnerOtp({ businessCode: 'BZ-ABC123', phoneNumber: '+254700000001' }, {
    store, env: { BIZPOA_OWNER_SESSION_SECRET: secret }, now, createCode: () => '123456',
  });
  const badCode = await verifyOwnerOtp({ businessCode: 'BZ-ABC123', phoneNumber: '+254700000001', code: '000000' }, {
    store, env: { BIZPOA_OWNER_SESSION_SECRET: secret }, now: now + 1000,
  });
  assert.deepEqual(badCode, { ok: false, reason: 'invalid_code' });
  const expired = await verifyOwnerOtp({ businessCode: 'BZ-ABC123', phoneNumber: '+254700000001', code: '123456' }, {
    store, env: { BIZPOA_OWNER_SESSION_SECRET: secret }, now: now + 6 * 60 * 1000,
  });
  assert.deepEqual(expired, { ok: false, reason: 'invalid_code' });
});

test('owner OTP is rate limited and fails closed when the signing secret is missing or weak', async (t) => {
  const store = await makeStore(t);
  assert.deepEqual(await createOwnerOtp({ businessCode: 'BZ-ABC123', phoneNumber: '+254700000001' }, {
    store, env: {}, now,
  }), { ok: false, reason: 'auth_not_configured' });
  const request = { businessCode: 'BZ-ABC123', phoneNumber: '+254700000001' };
  await createOwnerOtp(request, { store, env: { BIZPOA_OWNER_SESSION_SECRET: secret }, now, createCode: () => '111111' });
  assert.deepEqual(await createOwnerOtp(request, { store, env: { BIZPOA_OWNER_SESSION_SECRET: secret }, now: now + 30_000, createCode: () => '222222' }), {
    ok: false, reason: 'rate_limited',
  });
  assert.equal(normalizePhoneNumber('0700 000 001'), '+254700000001');
  assert.equal(normalizePhoneNumber('+254 700 000 001'), '+254700000001');
});
