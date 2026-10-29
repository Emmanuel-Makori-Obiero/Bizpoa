import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOwnerOtp, verifyOwnerOtp } from '../src/business-auth.js';
import { createStatementDownloadUrl } from '../src/statements.js';
import { createStore } from '../src/storage.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ownerSecret = 'owner-routes-secret-should-be-at-least-32-chars';
const statementSecret = 'statement-routes-secret-should-be-at-least-32-chars';

async function unusedPort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => socket.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function waitForServer(baseUrl, child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Bizpoa test server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Bizpoa test server did not become ready.');
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, 'exit').catch(() => {});
  child.kill('SIGTERM');
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function ownerToken(store, businessCode, phoneNumber, code, now) {
  await createOwnerOtp({ businessCode, phoneNumber }, {
    store, env: { BIZPOA_OWNER_SESSION_SECRET: ownerSecret }, now, createCode: () => code,
  });
  const verified = await verifyOwnerOtp({ businessCode, phoneNumber, code }, {
    store, env: { BIZPOA_OWNER_SESSION_SECRET: ownerSecret }, now: now + 1000,
  });
  assert.equal(verified.ok, true);
  return verified.accessToken;
}

test('business HTTP routes enforce owner-specific access and deliver statements only with valid credentials', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bizpoa-owner-routes-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const dataFile = path.join(directory, 'db.json');
  const store = createStore(dataFile);
  const today = new Date().toISOString().slice(0, 10);
  await store.transact((database) => {
    database.businesses['+254700000001'] = {
      code: 'BZ-ABC123', name: 'Amina Shop', phoneNumber: '+254700000001', type: 'Retail', categoryLabel: 'Shop', registeredAt: today,
    };
    database.businesses['+254700000002'] = {
      code: 'BZ-DEF456', name: 'Other Shop', phoneNumber: '+254700000002', type: 'Retail', categoryLabel: 'Shop', registeredAt: today,
    };
    database.businesses['+254700000003'] = {
      code: 'BZ-GHI789', name: 'Third Shop', phoneNumber: '+254700000003', type: 'Retail', categoryLabel: 'Shop', registeredAt: today,
    };
    database.transactions = [
      { id: 'A-SALE', businessCode: 'BZ-ABC123', phoneNumber: '+254700000001', type: 'sale', amount: 320, date: today, createdAt: `${today}T10:00:00.000Z` },
      { id: 'B-SALE', businessCode: 'BZ-DEF456', phoneNumber: '+254700000002', type: 'sale', amount: 9000, date: today, createdAt: `${today}T11:00:00.000Z` },
    ];
    database.smsNotes = [
      { businessCode: 'BZ-ABC123', phoneNumber: '+254700000001', text: 'Amina note', receivedAt: `${today}T10:00:00.000Z` },
      { businessCode: 'BZ-DEF456', phoneNumber: '+254700000002', text: 'Other note', receivedAt: `${today}T11:00:00.000Z` },
    ];
  });

  const issuedAt = Date.now();
  const tokenA = await ownerToken(store, 'BZ-ABC123', '+254700000001', '123456', issuedAt);
  const tokenB = await ownerToken(store, 'BZ-DEF456', '+254700000002', '654321', issuedAt + 120_000);
  const publicLink = createStatementDownloadUrl({
    businessCode: 'BZ-ABC123', phoneNumber: '+254700000001', days: 30,
    publicUrl: 'https://bizpoa.example', secret: statementSecret,
  });
  const statementPath = new URL(publicLink).pathname;

  const port = await unusedPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: projectRoot,
    stdio: 'ignore',
    env: {
      ...process.env,
      PORT: String(port),
      BIZPOA_STORAGE_DRIVER: 'json',
      DATA_FILE: dataFile,
      BIZPOA_OWNER_SESSION_SECRET: ownerSecret,
      BIZPOA_STATEMENT_SECRET: statementSecret,
      BIZPOA_PUBLIC_URL: 'https://bizpoa.example',
      AT_API_KEY: '',
      AT_ENV: 'sandbox',
      AT_USERNAME: 'sandbox',
      GEMINI_API_KEY: '',
      SUPABASE_URL: '',
      BIZPOA_ADMIN_EMAIL: '',
    },
  });
  t.after(() => stopChild(child));
  await waitForServer(baseUrl, child);

  const unauthorized = await fetch(`${baseUrl}/api/business/dashboard`);
  assert.equal(unauthorized.status, 401);

  const dashboardAResponse = await fetch(`${baseUrl}/api/business/dashboard?days=30`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  assert.equal(dashboardAResponse.status, 200);
  const dashboardA = await dashboardAResponse.json();
  assert.equal(dashboardA.business.code, 'BZ-ABC123');
  assert.deepEqual(dashboardA.transactions.map((item) => item.id), ['A-SALE']);
  assert.deepEqual(dashboardA.smsNotes.map((item) => item.text), ['Amina note']);
  assert.equal(dashboardA.summary.sales, 320);

  const dashboardBResponse = await fetch(`${baseUrl}/api/business/dashboard`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  const dashboardB = await dashboardBResponse.json();
  assert.equal(dashboardB.business.code, 'BZ-DEF456');
  assert.deepEqual(dashboardB.transactions.map((item) => item.id), ['B-SALE']);
  assert.equal((await fetch(`${baseUrl}/api/business/dashboard?days=366`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  })).status, 400);

  const csvResponse = await fetch(`${baseUrl}/api/business/statement.csv?days=30`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  assert.equal(csvResponse.status, 200);
  const csv = await csvResponse.text();
  assert.match(csv, /A-SALE/);
  assert.doesNotMatch(csv, /B-SALE|9000/);

  const signedCsvResponse = await fetch(`${baseUrl}${statementPath}`);
  assert.equal(signedCsvResponse.status, 200);
  assert.match(await signedCsvResponse.text(), /A-SALE/);
  const invalidCodeResponse = await fetch(`${baseUrl}/api/business/statement.csv?days=30`);
  assert.equal(invalidCodeResponse.status, 401);

  const otpRequest = await fetch(`${baseUrl}/api/business-auth/request-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessCode: 'BZ-GHI789', phoneNumber: '+254700000003' }),
  });
  assert.equal(otpRequest.status, 503);
  assert.equal((await otpRequest.json()).error, 'verification_sms_not_sent');
});
