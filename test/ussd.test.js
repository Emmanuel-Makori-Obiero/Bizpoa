import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/storage.js';
import { handleUssd, saveSmsBusinessDetail, saveSmsLanguage } from '../src/ussd.js';

async function testStore(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bizpoa-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return createStore(path.join(directory, 'db.json'));
}

const request = (sessionId, phoneNumber, text = '') => ({ sessionId, phoneNumber, text });

async function registerSwahiliBusiness(store, phoneNumber = '+254700000001', sessionId = 'reg') {
  await handleUssd(request(sessionId, phoneNumber), store);
  await handleUssd(request(sessionId, phoneNumber, '2'), store);
  assert.match(await handleUssd(request(sessionId, phoneNumber, '2*1'), store), /Chagua aina ya biashara/);
  assert.match(await handleUssd(request(sessionId, phoneNumber, '2*1*1'), store), /Chagua biashara \(Rejareja \/ duka\)/);
  assert.match(await handleUssd(request(sessionId, phoneNumber, '2*1*1*2'), store), /Weka jina la biashara yako/);
  return handleUssd(request(sessionId, phoneNumber, '2*1*1*2*Duka la Amina'), store);
}

test('new user selects Kiswahili and sees translated main choices', async (t) => {
  const store = await testStore(t);
  assert.match(await handleUssd(request('s1', '+254700000001'), store), /^CON Choose language/);
  assert.match(await handleUssd(request('s1', '+254700000001', '2'), store), /CON Bizpoa\n1\. Sajili biashara/);
  assert.match(await handleUssd(request('s1', '+254700000001', '2*5'), store), /Chagua lugha/);
});

test('registration creates a business profile and unique Bizpoa ID', async (t) => {
  const store = await testStore(t);
  const result = await registerSwahiliBusiness(store);
  assert.match(result, /Biashara imesajiliwa/);
  assert.match(result, /Duka la Amina \(Boutique\)/);
  assert.match(result, /Nambari ya Bizpoa: BZ-[A-Z0-9]{6}/);
});

test('each registered business receives a different Bizpoa ID', async (t) => {
  const store = await testStore(t);
  const first = await registerSwahiliBusiness(store, '+254700000011', 'reg-1');
  const second = await registerSwahiliBusiness(store, '+254700000012', 'reg-2');
  const firstCode = first.match(/BZ-[A-Z0-9]{6}/)?.[0];
  const secondCode = second.match(/BZ-[A-Z0-9]{6}/)?.[0];
  assert.ok(firstCode);
  assert.ok(secondCode);
  assert.notEqual(firstCode, secondCode);
});

test('business management records sale and expense; daily and 7-day audits total them', async (t) => {
  const store = await testStore(t);
  const registered = await registerSwahiliBusiness(store);
  const businessCode = registered.match(/BZ-[A-Z0-9]{6}/)?.[0];
  assert.ok(businessCode);

  assert.match(await handleUssd(request('home', '+254700000001'), store), new RegExp(`Bizpoa \\(${businessCode}\\)`));
  assert.match(await handleUssd(request('home', '+254700000001', '3'), store), /Simamia biashara/);
  assert.match(await handleUssd(request('home', '+254700000001', '3*1'), store), /Weka kiasi cha mauzo/);
  assert.match(await handleUssd(request('home', '+254700000001', '3*1*350'), store), /Mauzo ya 350 yamerekodiwa/);

  assert.match(await handleUssd(request('expense', '+254700000001'), store), /Simamia biashara/);
  assert.match(await handleUssd(request('expense', '+254700000001', '3'), store), /Simamia biashara/);
  assert.match(await handleUssd(request('expense', '+254700000001', '3*2'), store), /Weka kiasi cha matumizi/);
  assert.match(await handleUssd(request('expense', '+254700000001', '3*2*50.5'), store), /Matumizi ya 50.5 yamerekodiwa/);

  assert.match(await handleUssd(request('audit', '+254700000001'), store), /Ukaguzi wa leo/);
  assert.match(await handleUssd(request('audit', '+254700000001', '2'), store), /Mauzo: 350\nMatumizi: 50\.5\nFaida halisi: 299\.5/);
  assert.match(await handleUssd(request('weekly', '+254700000001'), store), /Ukaguzi wa siku 7/);
  assert.match(await handleUssd(request('weekly', '+254700000001', '4'), store), /Mauzo: 350\nMatumizi: 50\.5\nFaida halisi: 299\.5/);
});

test('English user can register and get a daily audit', async (t) => {
  const store = await testStore(t);
  await handleUssd(request('enreg', '+254700000002'), store);
  await handleUssd(request('enreg', '+254700000002', '1'), store);
  assert.match(await handleUssd(request('enreg', '+254700000002', '1*1'), store), /Choose business category/);
  assert.match(await handleUssd(request('enreg', '+254700000002', '1*1*1'), store), /Choose business type \(Retail \/ shop\)/);
  assert.match(await handleUssd(request('enreg', '+254700000002', '1*1*1*1'), store), /Enter your business name/);
  assert.match(await handleUssd(request('enreg', '+254700000002', '1*1*1*1*Quick Shop'), store), /Business registered/);
  assert.match(await handleUssd(request('daily', '+254700000002'), store), /Get today's audit/);
  assert.match(await handleUssd(request('daily', '+254700000002', '2'), store), /Today's audit\nSales: 0\nExpenses: 0\nNet: 0/);
});

test('SMS language commands update preference and other texts are saved as business details', async (t) => {
  const store = await testStore(t);
  const registration = await registerSwahiliBusiness(store, '+254700000003', 'sms-register');
  const code = registration.match(/BZ-[A-Z0-9]{6}/)?.[0];
  assert.ok(code);
  assert.equal(await saveSmsLanguage({ phoneNumber: '+254700000003', text: 'LUGHA KISWAHILI' }, store), 'sw');
  assert.match(await handleUssd(request('sms-user', '+254700000003'), store), /CON Bizpoa(?: \(BZ-[A-Z0-9]{6}\))?\n1\. Sajili biashara/);
  const saved = await saveSmsBusinessDetail({ phoneNumber: '+254700000003', text: `${code}, Located near the market; opens at 7am` }, store);
  assert.deepEqual(saved, { saved: true, businessCode: code });
  const rejected = await saveSmsBusinessDetail({ phoneNumber: '+254700000004', text: `${code}, stolen details` }, store);
  assert.deepEqual(rejected, { saved: false, reason: 'sender_mismatch' });
  await store.transact((database) => {
    assert.equal(database.smsNotes.length, 1);
    assert.equal(database.smsNotes[0].businessCode, code);
    assert.match(database.smsNotes[0].text, /near the market/);
  });
});
