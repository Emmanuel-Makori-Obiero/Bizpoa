import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/storage.js';
import { processIncomingSms } from '../src/server.js';

async function createTestStore(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bizpoa-incoming-sms-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return createStore(path.join(directory, 'db.json'));
}

async function seedBusiness(store, phoneNumber, language = 'en') {
  await store.transact((database) => {
    database.businesses[phoneNumber] = {
      code: 'BZ-ABC123',
      phoneNumber,
      name: 'Quick Shop',
      type: 'retail',
      categoryLabel: 'Shop',
      registeredAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    database.users[phoneNumber] = { language };
  });
}

function smsStub(sent) {
  return async (payload) => {
    sent.push(payload);
    return { sent: true, statusCode: 101 };
  };
}

test('unregistered senders receive Bizpoa onboarding instructions without storing their text', async (t) => {
  const store = await createTestStore(t);
  const sent = [];
  const result = await processIncomingSms({ phoneNumber: '+254700000101', text: 'Hello' }, null, {
    store,
    sendSmsImpl: smsStub(sent),
    env: {},
  });

  assert.equal(result.replied, true);
  assert.match(sent[0].message, /Bizpoa ID/);
  assert.match(sent[0].message, /62073/);
  assert.deepEqual(await store.read((database) => database.smsNotes), []);
});

test('registered owner receives the AI-reviewed reply and the note stays linked to that business', async (t) => {
  const store = await createTestStore(t);
  const phoneNumber = '+254700000102';
  await seedBusiness(store, phoneNumber);
  const sent = [];
  let analyzed = false;
  const result = await processIncomingSms({ phoneNumber, text: 'BZ-ABC123, located near the market' }, 'sms-ai-1', {
    store,
    sendSmsImpl: smsStub(sent),
    analyzeSmsImpl: async ({ business, text }) => {
      analyzed = true;
      assert.equal(business.code, 'BZ-ABC123');
      assert.match(text, /near the market/);
      return { ok: true, analysis: { topic: 'business_detail', summary: 'Shop is near the market.', reply: 'Thanks, noted.' } };
    },
    env: { GEMINI_API_KEY: 'test-key' },
  });

  assert.equal(result.replied, true);
  assert.equal(analyzed, true);
  assert.match(sent[0].message, /Shop is near the market/);
  assert.match(sent[0].message, /Thanks, noted/);
  const notes = await store.read((database) => database.smsNotes);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].businessCode, 'BZ-ABC123');
  assert.equal(notes[0].messageId, 'sms-ai-1');
  assert.equal(notes[0].aiSummary, 'Shop is near the market.');
});

test('unlinked messages get a non-disclosing correction and no business detail is stored', async (t) => {
  const store = await createTestStore(t);
  const owner = '+254700000103';
  const other = '+254700000104';
  await seedBusiness(store, owner);
  const sent = [];
  const result = await processIncomingSms({ phoneNumber: other, text: 'BZ-ABC123, private details' }, null, {
    store,
    sendSmsImpl: smsStub(sent),
    env: {},
  });

  assert.equal(result.replied, true);
  assert.match(sent[0].message, /register via USSD/i);
  assert.doesNotMatch(sent[0].message, /Quick Shop|private details|BZ-ABC123/);
  assert.deepEqual(await store.read((database) => database.smsNotes), []);
});

test('language preference messages receive a localized confirmation', async (t) => {
  const store = await createTestStore(t);
  const sent = [];
  await processIncomingSms({ phoneNumber: '+254700000105', text: 'LUGHA KISWAHILI' }, null, {
    store,
    sendSmsImpl: smsStub(sent),
    env: {},
  });
  assert.match(sent[0].message, /Lugha ya Kiswahili imehifadhiwa/);
  assert.match(sent[0].message, /62073/);
});

test('provider retries with the same message ID do not generate a second reply', async (t) => {
  const store = await createTestStore(t);
  const phoneNumber = '+254700000106';
  await seedBusiness(store, phoneNumber);
  const sent = [];
  const options = { store, sendSmsImpl: smsStub(sent), env: {} };
  await processIncomingSms({ phoneNumber, text: 'A normal message' }, 'duplicate-1', options);
  const duplicate = await processIncomingSms({ phoneNumber, text: 'A normal message' }, 'duplicate-1', options);
  assert.equal(duplicate.reason, 'duplicate_message');
  assert.equal(sent.length, 1);
});
