import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bizpoa-vercel-function-'));
process.env.BIZPOA_STORAGE_DRIVER = 'json';
process.env.DATA_FILE = path.join(directory, 'db.json');
process.env.BIZPOA_OWNER_SESSION_SECRET = '';

const [{ default: handler }, { handleRequest }] = await Promise.all([
  import('../api/[...path].js'),
  import('../src/server.js'),
]);

function makeRequest({ url, method = 'GET', body, headers = {} }) {
  const request = Readable.from([]);
  request.url = url;
  request.method = method;
  request.headers = { host: 'localhost', ...headers };
  if (body !== undefined) request.body = body;
  return request;
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
      this.body += Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
      this.finished = true;
    },
  };
}

test('Vercel function routes aliases, parsed bodies, and background webhook work', async (t) => {
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const healthResponse = makeResponse();
  await handler(makeRequest({ url: '/api/health' }), healthResponse);
  assert.equal(healthResponse.statusCode, 200);
  assert.match(healthResponse.body, /json storage are ready/);

  const ussdResponse = makeResponse();
  await handler(makeRequest({
    url: '/api/ussd',
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: { sessionId: 'vercel-test', phoneNumber: '+254700000099', text: '' },
  }), ussdResponse);
  assert.equal(ussdResponse.statusCode, 200);
  assert.match(ussdResponse.body, /^CON Bizpoa/);

  const authResponse = makeResponse();
  await handler(makeRequest({
    url: '/api/business-auth/request-code',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { businessCode: 'BZ-ABC123', phoneNumber: '+254700000099' },
  }), authResponse);
  assert.equal(authResponse.statusCode, 503);
  assert.deepEqual(JSON.parse(authResponse.body), { error: 'owner_login_not_configured' });

  const scheduled = [];
  const smsResponse = makeResponse();
  await handleRequest(makeRequest({
    url: '/api/sms/incoming',
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: { from: '+254700000099', text: 'Hello Bizpoa' },
  }), smsResponse, { waitUntil: (promise) => scheduled.push(promise) });
  assert.equal(smsResponse.statusCode, 200);
  assert.equal(smsResponse.body, 'OK');
  assert.equal(scheduled.length, 1);
  await Promise.all(scheduled);
});
