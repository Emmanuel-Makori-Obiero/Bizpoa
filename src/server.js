import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createStore } from './storage.js';
import { handleUssd, saveSmsBusinessDetail, saveSmsLanguage } from './ussd.js';
import { detailsSavedSms, registrationSms, sendSms } from './africastalking.js';
import { recordVoiceTransaction } from './voice.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function loadLocalEnvironment() {
  try {
    const lines = readFileSync(path.resolve(here, '../.env'), 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || match[1] in process.env) continue;
      const value = match[2].replace(/^(?:"(.*)"|'(.*)')$/, (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted ?? '');
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

loadLocalEnvironment();
const dataFile = process.env.DATA_FILE || path.resolve(here, '../data/bizpoa.json');
const store = createStore(dataFile);
const port = Number(process.env.PORT || 3000);
const maxBodyBytes = 64 * 1024;

async function readForm(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBodyBytes) throw new Error('Request body too large');
  }
  return new URLSearchParams(body);
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBodyBytes) throw new Error('Request body too large');
  }
  return JSON.parse(body || '{}');
}

function sendText(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function hasValidAdminToken(request) {
  const expected = process.env.BIZPOA_ADMIN_TOKEN;
  const supplied = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function dashboardData(database) {
  const today = new Date().toISOString().slice(0, 10);
  const weekStartDate = new Date(`${today}T00:00:00.000Z`);
  weekStartDate.setUTCDate(weekStartDate.getUTCDate() - 6);
  const weekStart = weekStartDate.toISOString().slice(0, 10);
  const weekTransactions = database.transactions.filter((item) => item.date >= weekStart && item.date <= today);
  const sales = weekTransactions.filter((item) => item.type === 'sale').reduce((sum, item) => sum + item.amount, 0);
  const expenses = weekTransactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0);
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      businessCount: Object.keys(database.businesses).length,
      transactionCount: weekTransactions.length,
      sales: Number(sales.toFixed(2)),
      expenses: Number(expenses.toFixed(2)),
      net: Number((sales - expenses).toFixed(2)),
      periodStart: weekStart,
      periodEnd: today,
    },
    businesses: Object.values(database.businesses).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    transactions: [...database.transactions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100),
    smsNotes: [...database.smsNotes].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 50),
  };
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (request.method === 'GET' && url.pathname === '/health') {
    return sendText(response, 200, 'Bizpoa sandbox backend is running.');
  }

  if (request.method === 'GET' && url.pathname === '/api/dashboard') {
    if (!process.env.BIZPOA_ADMIN_TOKEN) {
      return sendJson(response, 503, { error: 'Dashboard is not configured. Set BIZPOA_ADMIN_TOKEN in the backend .env file.' });
    }
    if (!hasValidAdminToken(request)) {
      return sendJson(response, 401, { error: 'Enter the correct Bizpoa dashboard token.' });
    }
    try {
      const payload = await store.read(dashboardData);
      return sendJson(response, 200, payload);
    } catch (error) {
      console.error('Dashboard data error:', error);
      return sendJson(response, 500, { error: 'Could not load dashboard data.' });
    }
  }

  if (request.method === 'POST' && url.pathname === '/api/voice/record') {
    if (!process.env.BIZPOA_ADMIN_TOKEN) {
      return sendJson(response, 503, { error: 'Dashboard is not configured. Set BIZPOA_ADMIN_TOKEN in the backend .env file.' });
    }
    if (!hasValidAdminToken(request)) {
      return sendJson(response, 401, { error: 'Enter the correct Bizpoa dashboard token.' });
    }
    try {
      const payload = await readJson(request);
      const result = await recordVoiceTransaction(payload, store);
      if (!result.ok) {
        const status = result.reason === 'unknown_business' ? 404 : 400;
        return sendJson(response, status, { error: result.reason });
      }
      return sendJson(response, 201, { transaction: result.transaction, business: result.business });
    } catch (error) {
      if (error instanceof SyntaxError || error.message === 'Request body too large') {
        return sendJson(response, 400, { error: 'Request body must be valid JSON and no larger than 64 KB.' });
      }
      console.error('Voice transaction error:', error);
      return sendJson(response, 500, { error: 'Could not record the transaction.' });
    }
  }

  if (request.method === 'POST' && url.pathname === '/ussd') {
    try {
      const form = await readForm(request);
      const ussdResponse = await handleUssd({
        sessionId: form.get('sessionId'),
        phoneNumber: form.get('phoneNumber'),
        text: form.get('text') ?? '',
      }, store);
      sendText(response, 200, ussdResponse);
      if (/^END (?:Business registered|Biashara imesajiliwa)/.test(ussdResponse)) {
        const code = ussdResponse.match(/\bBZ-[A-Z0-9]{6}\b/)?.[0];
        const phoneNumber = form.get('phoneNumber');
        if (code && phoneNumber) {
          void sendSms({ to: phoneNumber, message: registrationSms(code) }).then((result) => {
            if (result.sent) console.log('Bizpoa registration SMS accepted by Africa\'s Talking:', result.statusCode);
            else console.warn('Bizpoa registration SMS not sent:', result.reason);
          });
        }
      }
      return;
    } catch (error) {
      console.error('USSD callback error:', error);
      return sendText(response, 200, 'END Sorry, something went wrong. Please try again.');
    }
  }

  if (request.method === 'POST' && url.pathname === '/sms/incoming') {
    try {
      const form = await readForm(request);
      const message = {
        phoneNumber: form.get('from'),
        text: form.get('text') ?? '',
      };
      const language = await saveSmsLanguage(message, store);
      const detailResult = language ? { saved: false, reason: 'language_command' } : await saveSmsBusinessDetail(message, store);
      console.log('Incoming SMS:', {
        from: form.get('from'),
        languageCommandAccepted: Boolean(language),
        detailSaved: detailResult.saved,
        detailReason: detailResult.saved ? undefined : detailResult.reason,
      });
      sendText(response, 200, 'OK');
      if (detailResult.saved && detailResult.businessCode) {
        void sendSms({
          to: message.phoneNumber,
          message: detailsSavedSms(detailResult.businessCode),
        }).then((result) => {
          if (result.sent) console.log('Bizpoa SMS detail confirmation accepted by Africa\'s Talking:', result.statusCode);
          else console.warn('Bizpoa SMS detail confirmation not sent:', result.reason);
        });
      }
      return;
    } catch (error) {
      console.error('SMS callback error:', error);
      return sendText(response, 400, 'Bad request');
    }
  }

  return sendText(response, 404, 'Not found');
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Bizpoa sandbox backend listening on http://localhost:${port}`);
  console.log(`Data file: ${dataFile}`);
});

function stop() {
  server.close(() => process.exit(0));
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
