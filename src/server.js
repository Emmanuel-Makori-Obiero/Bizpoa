import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createStore } from './storage.js';
import { createSupabaseStore } from './supabase-storage.js';
import { createAdminAuthenticator } from './auth.js';
import { handleUssdAction, saveSmsBusinessDetail, saveSmsLanguage } from './ussd.js';
import { languageSavedSms, registrationSms, sendSms } from './africastalking.js';
import { buildStatementCsv, formatStatementSms, statementWindow, verifyStatementDownloadToken } from './statements.js';
import { analyzeBusinessSms, fallbackSmsReply } from './sms-ai.js';
import { clearOwnerOtp, createOwnerOtp, verifyOwnerOtp, verifyOwnerSessionToken } from './business-auth.js';
import { recordVoiceTransaction } from './voice.js';
import { reviewVoiceCommand } from './voice-review.js';

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
const storageDriver = process.env.BIZPOA_STORAGE_DRIVER || (process.env.NODE_ENV === 'production' ? 'supabase' : 'json');
if (!['json', 'supabase'].includes(storageDriver)) throw new Error('BIZPOA_STORAGE_DRIVER must be either "json" or "supabase".');
const store = storageDriver === 'supabase' ? createSupabaseStore() : createStore(dataFile);
const port = Number(process.env.PORT || 3000);
const maxBodyBytes = 64 * 1024;
const authenticateAdmin = createAdminAuthenticator({ env: process.env });

function validateBodySize(body) {
  if (Buffer.byteLength(body) > maxBodyBytes) throw new Error('Request body too large');
}

async function readRawBody(request) {
  if (request.body !== undefined) {
    const raw = Buffer.isBuffer(request.body) || request.body instanceof Uint8Array
      ? Buffer.from(request.body).toString('utf8')
      : typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? '');
    validateBodySize(raw);
    return raw;
  }
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    validateBodySize(body);
  }
  return body;
}

async function readForm(request) {
  const parsed = request.body;
  if (parsed && typeof parsed === 'object' && !Buffer.isBuffer(parsed) && !(parsed instanceof Uint8Array)) {
    validateBodySize(JSON.stringify(parsed));
    const entries = Object.entries(parsed).flatMap(([key, value]) =>
      (Array.isArray(value) ? value : [value]).map((item) => [key, String(item ?? '')]));
    return new URLSearchParams(entries);
  }
  return new URLSearchParams(await readRawBody(request));
}

async function readJson(request) {
  const parsed = request.body;
  if (parsed && typeof parsed === 'object' && !Buffer.isBuffer(parsed) && !(parsed instanceof Uint8Array)) {
    validateBodySize(JSON.stringify(parsed));
    return parsed;
  }
  return JSON.parse(await readRawBody(request) || '{}');
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

function smsBusinessForSender(database, phoneNumber, text) {
  const codeMatch = String(text ?? '').trim().match(/^(BZ-[A-Z0-9]{6})\b/i);
  if (codeMatch) {
    const business = Object.values(database.businesses ?? {}).find((item) => item.code === codeMatch[1].toUpperCase());
    return business?.phoneNumber === phoneNumber ? business : null;
  }
  return database.businesses?.[phoneNumber] ?? null;
}

function businessDashboardData(database, identity, days) {
  const business = Object.values(database.businesses ?? {}).find((item) =>
    item.code === identity.businessCode && item.phoneNumber === identity.phoneNumber);
  if (!business) return null;
  const window = statementWindow(days);
  if (!window) return null;
  const transactions = (database.transactions ?? []).filter((transaction) => {
    const belongs = transaction.businessCode === business.code
      || (!transaction.businessCode && transaction.phoneNumber === business.phoneNumber);
    return belongs && transaction.date >= window.start && transaction.date <= window.end;
  }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const sales = transactions.filter((item) => item.type === 'sale').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const expenses = transactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return {
    generatedAt: new Date().toISOString(),
    business: {
      code: business.code,
      name: business.name,
      type: business.type,
      categoryLabel: business.categoryLabel,
      registeredAt: business.registeredAt,
    },
    summary: {
      days,
      periodStart: window.start,
      periodEnd: window.end,
      transactionCount: transactions.length,
      sales: Number(sales.toFixed(2)),
      expenses: Number(expenses.toFixed(2)),
      net: Number((sales - expenses).toFixed(2)),
    },
    transactions: transactions.slice(0, 200),
    smsNotes: (database.smsNotes ?? []).filter((note) =>
      note.businessCode === business.code || (!note.businessCode && note.phoneNumber === business.phoneNumber))
      .sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt))).slice(0, 50),
  };
}

function ownerIdentityFromRequest(request) {
  const token = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  return verifyOwnerSessionToken(token, process.env.BIZPOA_OWNER_SESSION_SECRET);
}

function unregisteredSmsReply(language) {
  return language === 'sw'
    ? 'Bizpoa: Tumepokea ujumbe wako. Sajili biashara kwa USSD, kisha tuma BZ-XXXXXX na maelezo yako kwa 62073 kutoka simu hiyo.'
    : 'Bizpoa: Message received. Register via USSD to get your Bizpoa ID, then text BZ-XXXXXX and your business details to 62073 from that same phone.';
}

function unlinkedSmsReply(language, reason) {
  if (reason === 'message_too_long') {
    return language === 'sw'
      ? 'Bizpoa: Ujumbe ni mrefu sana. Tuma ujumbe mfupi chini ya herufi 1,000.'
      : 'Bizpoa: That message is too long. Please resend it in fewer than 1,000 characters.';
  }
  return language === 'sw'
    ? 'Bizpoa: Ujumbe umepokelewa lakini haukuunganishwa. Tuma BZ-XXXXXX, kisha maelezo yako, kwa 62073 kutoka simu uliyosajili.'
    : 'Bizpoa: We received your message but could not link it. Text BZ-XXXXXX, then your details, to 62073 from your registered phone.';
}

const smsReplyWindow = new Map();
function allowSmsAiReply(phoneNumber, now = Date.now()) {
  const recent = (smsReplyWindow.get(phoneNumber) ?? []).filter((timestamp) => now - timestamp < 60 * 60 * 1000);
  if (recent.length >= 5) {
    smsReplyWindow.set(phoneNumber, recent);
    return false;
  }
  recent.push(now);
  smsReplyWindow.set(phoneNumber, recent);
  return true;
}

export async function processIncomingSms(message, messageId, {
  store: smsStore = store,
  sendSmsImpl = sendSms,
  analyzeSmsImpl = analyzeBusinessSms,
  env = process.env,
} = {}) {
  const phoneNumber = String(message.phoneNumber ?? '').trim();
  const text = String(message.text ?? '');
  if (!phoneNumber) return { replied: false, reason: 'missing_sender' };

  const duplicate = messageId
    ? await smsStore.read((database) => (database.smsNotes ?? []).some((note) => note.messageId === messageId))
    : false;
  if (duplicate) return { replied: false, reason: 'duplicate_message' };

  const normalizedMessage = { phoneNumber, text };
  const language = await saveSmsLanguage(normalizedMessage, smsStore);
  const business = language ? null : await smsStore.read((database) => smsBusinessForSender(database, phoneNumber, text));
  const languagePreference = language ?? await smsStore.read((database) => database.users[phoneNumber]?.language ?? 'en');
  const mayReply = allowSmsAiReply(phoneNumber);
  const aiResult = business && mayReply
    ? await analyzeSmsImpl({ text, business, language: languagePreference }, { env })
    : null;
  const analysis = aiResult?.ok ? aiResult.analysis : null;
  const detailResult = language
    ? { saved: false, reason: 'language_command' }
    : business
      ? await saveSmsBusinessDetail(normalizedMessage, smsStore, { analysis, messageId })
      : { saved: false, reason: 'unregistered_sender' };

  console.log('Incoming SMS:', {
    from: phoneNumber,
    messageId: Boolean(messageId),
    languageCommandAccepted: Boolean(language),
    knownBusiness: Boolean(business),
    detailSaved: detailResult.saved,
    detailReason: detailResult.saved ? undefined : detailResult.reason,
    aiReplyReady: Boolean(analysis),
  });

  if (!mayReply) {
    console.warn('Bizpoa SMS AI reply rate limit reached for a sender.');
    return { replied: false, reason: 'rate_limited' };
  }

  let reply;
  if (language) {
    reply = languageSavedSms(language);
  } else if (!business) {
    reply = unregisteredSmsReply(languagePreference);
  } else if (!detailResult.saved || !detailResult.businessCode) {
    reply = unlinkedSmsReply(languagePreference, detailResult.reason);
  } else {
    reply = analysis
      ? `Bizpoa summary: ${analysis.summary}\n${analysis.reply}`
      : fallbackSmsReply({ business, language: languagePreference });
  }

  const result = await sendSmsImpl({ to: phoneNumber, message: reply }, { env });
  if (result.sent) console.log('Bizpoa incoming SMS feedback accepted:', result.statusCode);
  else console.warn('Bizpoa incoming SMS feedback not sent:', result.reason);
  return { replied: Boolean(result.sent), reason: result.reason ?? null, message: reply };
}

export async function handleRequest(request, response, {
  waitUntil = (promise) => { void promise; },
  sendSmsImpl = sendSms,
  analyzeSmsImpl = analyzeBusinessSms,
} = {}) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (url.pathname === '/api/health') url.pathname = '/health';
  else if (url.pathname === '/api/ussd') url.pathname = '/ussd';
  else if (url.pathname === '/api/sms/incoming') url.pathname = '/sms/incoming';
  else if (url.pathname.startsWith('/api/statement/')) url.pathname = url.pathname.slice('/api'.length);

  const scheduleBackground = (promise, label) => {
    const task = Promise.resolve(promise).catch((error) => console.error(label, error));
    try {
      waitUntil(task);
    } catch (error) {
      console.error('Could not register background task:', error);
      void task;
    }
  };

  if (request.method === 'GET' && url.pathname === '/health') {
    try {
      await store.read(() => true);
      return sendText(response, 200, `Bizpoa backend and ${storageDriver} storage are ready.`);
    } catch {
      return sendText(response, 503, 'Bizpoa backend storage is unavailable.');
    }
  }

  if (request.method === 'POST' && url.pathname === '/api/business-auth/request-code') {
    try {
      const payload = await readJson(request);
      const challenge = await createOwnerOtp(payload, { store });
      if (challenge.reason === 'auth_not_configured') return sendJson(response, 503, { error: 'owner_login_not_configured' });
      if (challenge.reason === 'rate_limited') return sendJson(response, 429, { error: 'too_many_code_requests' });
      if (!challenge.ok && challenge.reason !== 'owner_not_found') return sendJson(response, 400, { error: 'invalid_business_details' });
      if (challenge.ok) {
        const sent = await sendSms({
          to: challenge.phoneNumber,
          message: `Bizpoa verification code: ${challenge.code}. It expires in 5 minutes. Do not share this code.`,
        });
        if (!sent.sent) {
          await clearOwnerOtp(payload, store);
          return sendJson(response, 503, { error: 'verification_sms_not_sent' });
        }
      }
      return sendJson(response, 202, { message: 'If the Bizpoa ID and registered phone match, a verification code has been sent.' });
    } catch (error) {
      if (error instanceof SyntaxError || error.message === 'Request body too large') {
        return sendJson(response, 400, { error: 'Request body must be valid JSON and no larger than 64 KB.' });
      }
      console.error('Owner OTP request error:', error);
      return sendJson(response, 500, { error: 'Could not request a Bizpoa verification code.' });
    }
  }

  if (request.method === 'POST' && url.pathname === '/api/business-auth/verify-code') {
    try {
      const payload = await readJson(request);
      const verified = await verifyOwnerOtp(payload, { store });
      if (!verified.ok) {
        const status = verified.reason === 'auth_not_configured' ? 503 : 401;
        return sendJson(response, status, { error: verified.reason === 'auth_not_configured' ? 'owner_login_not_configured' : 'invalid_or_expired_code' });
      }
      return sendJson(response, 200, {
        accessToken: verified.accessToken,
        expiresAt: verified.expiresAt,
        business: verified.business,
      });
    } catch (error) {
      if (error instanceof SyntaxError || error.message === 'Request body too large') {
        return sendJson(response, 400, { error: 'Request body must be valid JSON and no larger than 64 KB.' });
      }
      console.error('Owner OTP verification error:', error);
      return sendJson(response, 500, { error: 'Could not verify the Bizpoa code.' });
    }
  }

  if (request.method === 'GET' && url.pathname === '/api/business/dashboard') {
    const identity = ownerIdentityFromRequest(request);
    if (!identity) return sendJson(response, 401, { error: 'business_session_required' });
    const days = Number(url.searchParams.get('days') || 30);
    if (!Number.isInteger(days) || days < 1 || days > 365) return sendJson(response, 400, { error: 'days_must_be_1_to_365' });
    try {
      const payload = await store.read((database) => businessDashboardData(database, identity, days));
      if (!payload) return sendJson(response, 404, { error: 'business_not_found' });
      return sendJson(response, 200, payload);
    } catch (error) {
      console.error('Business dashboard error:', error);
      return sendJson(response, 500, { error: 'Could not load this business dashboard.' });
    }
  }

  if (request.method === 'GET' && url.pathname === '/api/business/statement.csv') {
    const identity = ownerIdentityFromRequest(request);
    if (!identity) return sendJson(response, 401, { error: 'business_session_required' });
    const days = Number(url.searchParams.get('days') || 30);
    if (!Number.isInteger(days) || days < 1 || days > 365) return sendJson(response, 400, { error: 'days_must_be_1_to_365' });
    const csv = await store.read((database) => {
      const business = Object.values(database.businesses ?? {}).find((item) =>
        item.code === identity.businessCode && item.phoneNumber === identity.phoneNumber);
      return business ? buildStatementCsv(database, { businessCode: identity.businessCode, days }) : null;
    });
    if (!csv) return sendJson(response, 404, { error: 'business_not_found' });
    response.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="bizpoa-${identity.businessCode}-${days}-day-ledger.csv"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return response.end(csv);
  }

  if (request.method === 'POST' && url.pathname === '/api/business/statement-sms') {
    const identity = ownerIdentityFromRequest(request);
    if (!identity) return sendJson(response, 401, { error: 'business_session_required' });
    try {
      const payload = await readJson(request);
      const days = Number(payload.days);
      if (!Number.isInteger(days) || days < 1 || days > 365) return sendJson(response, 400, { error: 'days_must_be_1_to_365' });
      const statement = await store.read((database) => {
        const business = Object.values(database.businesses ?? {}).find((item) =>
          item.code === identity.businessCode && item.phoneNumber === identity.phoneNumber);
        if (!business) return null;
        const language = database.users[identity.phoneNumber]?.language ?? 'en';
        return { business, language, message: formatStatementSms(database, business, days, language) };
      });
      if (!statement) return sendJson(response, 404, { error: 'business_not_found' });
      const result = await sendSms({ to: identity.phoneNumber, message: statement.message });
      if (!result.sent) return sendJson(response, 502, { error: 'statement_sms_not_sent' });
      return sendJson(response, 202, { sent: true, message: 'The statement summary was sent by SMS.' });
    } catch (error) {
      if (error instanceof SyntaxError || error.message === 'Request body too large') {
        return sendJson(response, 400, { error: 'Request body must be valid JSON and no larger than 64 KB.' });
      }
      console.error('Owner statement SMS error:', error);
      return sendJson(response, 500, { error: 'Could not send the statement SMS.' });
    }
  }

  const statementMatch = url.pathname.match(/^\/statement\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\.csv$/);
  if (request.method === 'GET' && statementMatch) {
    const statement = verifyStatementDownloadToken(statementMatch[1], process.env.BIZPOA_STATEMENT_SECRET);
    if (!statement) return sendText(response, 404, 'This Bizpoa statement link is invalid or has expired.');
    try {
      const csv = await store.read((database) => {
        const business = Object.values(database.businesses ?? {}).find((item) => item.code === statement.businessCode);
        return business ? buildStatementCsv(database, statement) : null;
      });
      if (!csv) return sendText(response, 404, 'This Bizpoa statement is no longer available.');
      response.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="bizpoa-${statement.businessCode}-${statement.days}-day-ledger.csv"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      return response.end(csv);
    } catch (error) {
      console.error('Statement download error:', error);
      return sendText(response, 500, 'Could not create this Bizpoa statement.');
    }
  }

  if (request.method === 'GET' && url.pathname === '/api/dashboard') {
    const auth = await authenticateAdmin(request);
    if (!auth.ok) return sendJson(response, auth.status, { error: auth.error });
    try {
      const payload = await store.read(dashboardData);
      return sendJson(response, 200, payload);
    } catch (error) {
      console.error('Dashboard data error:', error);
      return sendJson(response, 500, { error: 'Could not load dashboard data.' });
    }
  }

  if (request.method === 'POST' && url.pathname === '/api/voice/record') {
    const auth = await authenticateAdmin(request);
    if (!auth.ok) return sendJson(response, auth.status, { error: auth.error });
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

  if (request.method === 'POST' && url.pathname === '/api/voice/review') {
    const auth = await authenticateAdmin(request);
    if (!auth.ok) return sendJson(response, auth.status, { error: auth.error });
    try {
      const payload = await readJson(request);
      const result = await reviewVoiceCommand(payload, { store });
      if (!result.ok) {
        const status = result.reason === 'missing_ai_key' ? 503
          : result.reason === 'unknown_business' ? 404
            : result.reason === 'ai_unavailable' || result.reason === 'ai_provider_error' ? 502 : 400;
        return sendJson(response, status, { error: result.reason });
      }
      return sendJson(response, 200, result);
    } catch (error) {
      if (error instanceof SyntaxError || error.message === 'Request body too large') {
        return sendJson(response, 400, { error: 'Request body must be valid JSON and no larger than 64 KB.' });
      }
      console.error('Voice review error:', error);
      return sendJson(response, 500, { error: 'Could not review the command.' });
    }
  }

  if (request.method === 'POST' && url.pathname === '/ussd') {
    try {
      const form = await readForm(request);
      const ussdResult = await handleUssdAction({
        sessionId: form.get('sessionId'),
        phoneNumber: form.get('phoneNumber'),
        text: form.get('text') ?? '',
      }, store, {
        publicUrl: process.env.BIZPOA_PUBLIC_URL,
        secret: process.env.BIZPOA_STATEMENT_SECRET,
      });
      const ussdResponse = ussdResult.response;
      sendText(response, 200, ussdResponse);
      if (ussdResult.outboundSms) {
        scheduleBackground(sendSms(ussdResult.outboundSms).then((result) => {
          if (result.sent) console.log('Bizpoa requested statement SMS accepted by Africa\'s Talking:', result.statusCode);
          else console.warn('Bizpoa statement SMS not sent:', result.reason);
        }), 'USSD statement SMS background task failed:');
      }
      if (/^END (?:Business registered|Biashara imesajiliwa)/.test(ussdResponse)) {
        const code = ussdResponse.match(/\bBZ-[A-Z0-9]{6}\b/)?.[0];
        const phoneNumber = form.get('phoneNumber');
        if (code && phoneNumber) {
          scheduleBackground(sendSms({ to: phoneNumber, message: registrationSms(code) }).then((result) => {
            if (result.sent) console.log('Bizpoa registration SMS accepted by Africa\'s Talking:', result.statusCode);
            else console.warn('Bizpoa registration SMS not sent:', result.reason);
          }), 'Registration SMS background task failed:');
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
      const messageId = form.get('id') || form.get('messageId') || form.get('linkId') || null;
      sendText(response, 200, 'OK');
      scheduleBackground(processIncomingSms(message, messageId, {
        sendSmsImpl,
        analyzeSmsImpl,
      }), 'Incoming SMS processing error:');
      return;
    } catch (error) {
      console.error('SMS callback error:', error);
      return sendText(response, 400, 'Bad request');
    }
  }

  return sendText(response, 404, 'Not found');
}

function startLocalServer() {
  const server = http.createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      console.error('Unhandled Bizpoa request error:', error);
      if (!response.headersSent) sendJson(response, 500, { error: 'Internal server error.' });
      else response.end();
    });
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`Bizpoa sandbox backend listening on http://localhost:${port}`);
    console.log(`Storage driver: ${storageDriver}${storageDriver === 'json' ? ` (${dataFile})` : ''}`);
  });
  return server;
}

const isDirectExecution = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  const server = startLocalServer();
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
