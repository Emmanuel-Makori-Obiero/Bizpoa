import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { handleRequest } from '../src/server.js';
import { createStore } from '../src/storage.js';

function makeRequest(body) {
  return {
    url: '/api/admin/clear-data',
    method: 'POST',
    headers: { host: 'localhost', 'content-type': 'application/json' },
    body,
  };
}

function makeResponse() {
  return {
    headersSent: false,
    statusCode: null,
    headers: {},
    body: '',
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
      this.headersSent = true;
      return this;
    },
    end(body = '') {
      this.body += String(body);
      this.finished = true;
    },
  };
}

async function makeSeededStore(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bizpoa-admin-clear-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = createStore(path.join(directory, 'db.json'));
  await store.transact((database) => {
    database.users['+254700000001'] = { language: 'en' };
    database.sessions.session1 = { phoneNumber: '+254700000001' };
    database.businesses['+254700000001'] = { code: 'BZ-ABC123', name: 'Amina Shop', phoneNumber: '+254700000001' };
    database.transactions = [{ id: 'sale1', businessCode: 'BZ-ABC123', phoneNumber: '+254700000001', type: 'sale', amount: 300, date: '2026-10-29', createdAt: '2026-10-29T10:00:00.000Z' }];
    database.smsNotes = [{ id: 'note1', businessCode: 'BZ-ABC123', phoneNumber: '+254700000001', text: 'Open at 7am' }];
    database.ownerOtpChallenges['BZ-ABC123:+254700000001'] = { codeHash: 'hash', expiresAt: 1, sentAt: 1, attempts: 0 };
    database.ownerOtpRateLimits['BZ-ABC123:+254700000001'] = { requestTimes: [1], lastSentAt: 1 };
  });
  return store;
}

const adminAuth = async () => ({ ok: true, user: { id: 'admin-1', email: 'admin@example.com' } });

test('admin data-clear endpoint rejects unauthenticated users without changing records', async (t) => {
  const store = await makeSeededStore(t);
  const before = await store.read((database) => structuredClone(database));
  const response = makeResponse();
  await handleRequest(makeRequest({ confirmation: 'CLEAR ALL BIZPOA DATA' }), response, {
    store,
    authenticateAdmin: async () => ({ ok: false, status: 401, error: 'sign-in required' }),
  });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(await store.read((database) => database), before);
});

test('admin data-clear endpoint requires the exact confirmation phrase and preserves records otherwise', async (t) => {
  const store = await makeSeededStore(t);
  const before = await store.read((database) => structuredClone(database));
  const response = makeResponse();
  await handleRequest(makeRequest({ confirmation: 'clear the records' }), response, { store, authenticateAdmin: adminAuth });
  assert.equal(response.statusCode, 400);
  assert.match(JSON.parse(response.body).error, /CLEAR ALL BIZPOA DATA/);
  assert.deepEqual(await store.read((database) => database), before);
});

test('admin data-clear endpoint clears every Bizpoa record type and returns only aggregate counts', async (t) => {
  const store = await makeSeededStore(t);
  const response = makeResponse();
  await handleRequest(makeRequest({ confirmation: 'CLEAR ALL BIZPOA DATA' }), response, { store, authenticateAdmin: adminAuth });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    ok: true,
    cleared: { businesses: 1, transactions: 1, smsNotes: 1 },
  });
  assert.deepEqual(await store.read((database) => database), {
    users: {}, sessions: {}, transactions: [], businesses: {}, smsNotes: [], ownerOtpChallenges: {}, ownerOtpRateLimits: {},
  });
});
