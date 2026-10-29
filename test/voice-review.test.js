import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/storage.js';
import { reviewVoiceCommand } from '../src/voice-review.js';

async function makeStore(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bizpoa-ai-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = createStore(path.join(directory, 'db.json'));
  await store.transact((database) => {
    database.businesses['+254700000001'] = {
      code: 'BZ-ABC123', name: 'Amina Shop', phoneNumber: '+254700000001',
    };
  });
  return store;
}

function providerResponse(review) {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(review) }] } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

const readySale = {
  intent: 'record_transaction',
  transactionType: 'sale',
  amount: 300,
  summary: 'Record a tomato sale of KES 300.',
  needsClarification: false,
  clarification: '',
  confidence: 0.93,
};

test('AI review asks Gemini to interpret natural language and returns a proposal without saving', async (t) => {
  const store = await makeStore(t);
  let request;
  const result = await reviewVoiceCommand({
    command: 'I sold three hundred shillings of tomatoes',
    businessCode: 'BZ-ABC123',
  }, {
    store,
    env: { GEMINI_API_KEY: 'server-secret', BIZPOA_AI_MODEL: 'gemini-test-model' },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return providerResponse(readySale);
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.review, {
    ready: true,
    type: 'sale',
    amount: 300,
    summary: readySale.summary,
    clarification: '',
    confidence: 0.93,
  });
  assert.equal(result.business.name, 'Amina Shop');
  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent');
  assert.equal(request.options.headers['x-goog-api-key'], 'server-secret');
  assert.equal(JSON.parse(request.options.body).generationConfig.responseMimeType, 'application/json');
  assert.match(JSON.stringify(JSON.parse(request.options.body)), /three hundred shillings of tomatoes/);
  await store.read((database) => assert.equal(database.transactions.length, 0));
});

test('AI review returns a clarification and does not create a save-ready proposal when command is ambiguous', async () => {
  const result = await reviewVoiceCommand({ command: 'Record that I bought some stock', businessCode: 'BZ-ABC123' }, {
    env: { GEMINI_API_KEY: 'server-secret' },
    fetchImpl: async () => providerResponse({
      intent: 'record_transaction',
      transactionType: 'expense',
      amount: null,
      summary: 'The owner bought stock but did not say the amount.',
      needsClarification: true,
      clarification: 'How much did the stock cost?',
      confidence: 0.4,
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.review.ready, false);
  assert.equal(result.review.type, null);
  assert.equal(result.review.amount, null);
  assert.equal(result.review.clarification, 'How much did the stock cost?');
});

test('AI review refuses to call Gemini without a server-side key', async () => {
  let called = false;
  const result = await reviewVoiceCommand({ command: 'sale 300', businessCode: 'BZ-ABC123' }, {
    env: {},
    fetchImpl: async () => { called = true; throw new Error('must not call'); },
  });
  assert.deepEqual(result, { ok: false, reason: 'missing_ai_key' });
  assert.equal(called, false);
});

test('AI review rejects unknown business, oversized commands, and unsafe model outputs', async (t) => {
  const store = await makeStore(t);
  let calls = 0;
  const options = {
    store,
    env: { GEMINI_API_KEY: 'server-secret' },
    fetchImpl: async () => { calls += 1; return providerResponse({ ...readySale, amount: 1.001 }); },
  };
  assert.deepEqual(await reviewVoiceCommand({ command: 'sale 300', businessCode: 'BZ-XXXXXX' }, options), {
    ok: false, reason: 'unknown_business',
  });
  assert.deepEqual(await reviewVoiceCommand({ command: 'a'.repeat(1001), businessCode: 'BZ-ABC123' }, options), {
    ok: false, reason: 'command_too_long',
  });
  assert.deepEqual(await reviewVoiceCommand({ command: 'sale three hundred', businessCode: 'BZ-ABC123' }, options), {
    ok: false, reason: 'ai_invalid_response',
  });
  assert.equal(calls, 1);
});
