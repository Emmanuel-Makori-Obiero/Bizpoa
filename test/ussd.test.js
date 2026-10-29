import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/storage.js';
import { handleUssd, handleUssdAction, saveSmsBusinessDetail, saveSmsLanguage } from '../src/ussd.js';

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

async function registerEnglishBusiness(store, phoneNumber = '+254700000002', sessionId = 'enreg') {
  await handleUssd(request(sessionId, phoneNumber), store);
  await handleUssd(request(sessionId, phoneNumber, '1'), store);
  await handleUssd(request(sessionId, phoneNumber, '1*1'), store);
  await handleUssd(request(sessionId, phoneNumber, '1*1*1'), store);
  await handleUssd(request(sessionId, phoneNumber, '1*1*1*1'), store);
  return handleUssd(request(sessionId, phoneNumber, '1*1*1*1*Quick Shop'), store);
}

async function addTransaction(store, phoneNumber, businessCode, type, amount, sessionId) {
  const option = type === 'sale' ? '1' : '2';
  await handleUssd(request(sessionId, phoneNumber), store);
  assert.match(await handleUssd(request(sessionId, phoneNumber, '2'), store), /Enter your Bizpoa business ID|Weka nambari ya biashara ya Bizpoa/);
  assert.match(await handleUssd(request(sessionId, phoneNumber, `2*${businessCode}`), store), /Record sale|Rekodi mauzo/);
  const prompt = await handleUssd(request(sessionId, phoneNumber, `2*${businessCode}*${option}`), store);
  assert.match(prompt, type === 'sale' ? /sale amount|kiasi cha mauzo/i : /expense amount|kiasi cha matumizi/i);
  return handleUssd(request(sessionId, phoneNumber, `2*${businessCode}*${option}*${amount}`), store);
}

test('new user selects Kiswahili and sees branded, translated main choices', async (t) => {
  const store = await testStore(t);
  assert.match(await handleUssd(request('s1', '+254700000001'), store), /^CON Bizpoa\nChoose language/);
  assert.match(await handleUssd(request('s1', '+254700000001', '2'), store), /CON Bizpoa\n1\. Sajili biashara/);
  assert.match(await handleUssd(request('s1', '+254700000001', '2\*4'), store), /Chagua lugha/);
});

test('registration creates a unique Bizpoa ID and gives the short-code SMS instructions', async (t) => {
  const store = await testStore(t);
  const result = await registerSwahiliBusiness(store);
  assert.match(result, /Biashara imesajiliwa/);
  assert.match(result, /Duka la Amina \(Boutique\)/);
  assert.match(result, /Nambari ya Bizpoa: BZ-[A-Z0-9]{6}/);
  assert.match(result, /62073/);
  assert.match(result, /simu iliyosajiliwa/);
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

test('management requires the caller-owned Bizpoa ID and records sales/expenses only after validation', async (t) => {
  const store = await testStore(t);
  const registered = await registerSwahiliBusiness(store);
  const businessCode = registered.match(/BZ-[A-Z0-9]{6}/)?.[0];
  assert.ok(businessCode);

  await handleUssd(request('manage', '+254700000001'), store);
  assert.match(await handleUssd(request('manage', '+254700000001', '2'), store), /Weka nambari ya biashara ya Bizpoa/);
  assert.match(await handleUssd(request('manage', '+254700000001', '2*BZ-XXXXXX'), store), /haiendani na simu hii iliyosajiliwa/);
  assert.match(await handleUssd(request('manage', '+254700000001', `2*BZ-XXXXXX*${businessCode}`), store), /Rekodi mauzo/);
  assert.match(await handleUssd(request('manage', '+254700000001', `2*BZ-XXXXXX*${businessCode}*1`), store), /Weka kiasi cha mauzo/);
  assert.match(await handleUssd(request('manage', '+254700000001', `2*BZ-XXXXXX*${businessCode}*1*350`), store), /Mauzo ya 350 yamerekodiwa/);

  assert.match(await addTransaction(store, '+254700000001', businessCode, 'expense', '50.5', 'expense'), /Matumizi ya 50\.5 yamerekodiwa/);
  const auditSession = 'audit';
  await handleUssd(request(auditSession, '+254700000001'), store);
  assert.match(await handleUssd(request(auditSession, '+254700000001', '3'), store), /Weka idadi ya siku za kukagua \(1-365\)/);
  assert.match(await handleUssd(request(auditSession, '+254700000001', '3*30'), store), /Tuma muhtasari kwa SMS/);
  const delivered = await handleUssdAction(request(auditSession, '+254700000001', '3*30*1'), store);
  assert.match(delivered.response, /Muhtasari wa taarifa unatumiwa kwa SMS/);
  assert.equal(delivered.outboundSms.to, '+254700000001');
  assert.match(delivered.outboundSms.message, /30 siku/);
  assert.match(delivered.outboundSms.message, /Mauzo KES 350\.00/);
  assert.match(delivered.outboundSms.message, /Matumizi KES 50\.50/);
});

test('USSD supports 0 back and 00 home from nested stages', async (t) => {
  const store = await testStore(t);
  const phone = '+254700000020';
  const session = 'navigation';
  await handleUssd(request(session, phone), store);
  await handleUssd(request(session, phone, '1'), store);
  assert.match(await handleUssd(request(session, phone, '1*1'), store), /Choose business category/);
  assert.match(await handleUssd(request(session, phone, '1*1*1'), store), /Choose business type/);
  assert.match(await handleUssd(request(session, phone, '1*1*1*0'), store), /Choose business category/);
  assert.match(await handleUssd(request(session, phone, '1*1*1*0*00'), store), /Bizpoa\n1\. Register business/);
});

test('custom audit range rejects invalid values and offers an expiring CSV link when configured', async (t) => {
  const store = await testStore(t);
  const registration = await registerEnglishBusiness(store);
  const code = registration.match(/BZ-[A-Z0-9]{6}/)?.[0];
  assert.ok(code);
  await addTransaction(store, '+254700000002', code, 'sale', '200', 'en-sale');
  const session = 'document-audit';
  const options = { publicUrl: 'https://bizpoa.example', secret: 'test-statement-secret-at-least-32-characters-long' };
  await handleUssdAction(request(session, '+254700000002'), store, options);
  assert.match((await handleUssdAction(request(session, '+254700000002', '3'), store, options)).response, /Enter the number of days to audit/);
  const invalidDays = await handleUssdAction(request(session, '+254700000002', '3*366'), store, options);
  assert.match(invalidDays.response, /whole number from 1 to 365/);
  const session2 = 'document-audit-valid';
  await handleUssdAction(request(session2, '+254700000002'), store, options);
  await handleUssdAction(request(session2, '+254700000002', '3'), store, options);
  const delivery = await handleUssdAction(request(session2, '+254700000002', '3*14'), store, options);
  assert.match(delivery.response, /Send CSV ledger link by SMS/);
  const result = await handleUssdAction(request(session2, '+254700000002', '3*14*2'), store, options);
  assert.match(result.response, /CSV ledger link is being sent/);
  assert.match(result.outboundSms.message, /https:\/\/bizpoa\.example\/statement\/.*\.csv/);
});

test('English user can register and choose a custom audit period', async (t) => {
  const store = await testStore(t);
  const registration = await registerEnglishBusiness(store);
  const code = registration.match(/BZ-[A-Z0-9]{6}/)?.[0];
  assert.ok(code);
  const session = 'daily';
  await handleUssd(request(session, '+254700000002'), store);
  assert.match(await handleUssd(request(session, '+254700000002', '3'), store), /Enter the number of days to audit/);
  assert.match(await handleUssd(request(session, '+254700000002', '3*366'), store), /whole number from 1 to 365/);
  assert.match(await handleUssd(request(session, '+254700000002', '3*366*1'), store), /Send summary by SMS/);
});

test('SMS language commands update preference; owner details are linked only to the registered sender', async (t) => {
  const store = await testStore(t);
  const registration = await registerSwahiliBusiness(store, '+254700000003', 'sms-register');
  const code = registration.match(/BZ-[A-Z0-9]{6}/)?.[0];
  assert.ok(code);
  assert.equal(await saveSmsLanguage({ phoneNumber: '+254700000003', text: 'LUGHA KISWAHILI' }, store), 'sw');
  assert.match(await handleUssd(request('sms-user', '+254700000003'), store), /CON Bizpoa/);
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
