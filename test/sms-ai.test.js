import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBusinessSms, fallbackSmsReply } from '../src/sms-ai.js';

function providerResponse(value) {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

const business = { code: 'BZ-ABC123', name: 'Amina Shop' };
const response = {
  topic: 'business_detail',
  summary: 'The shop is near the market and opens at 7am.',
  reply: 'Bizpoa received these details for your business.',
};

test('Gemini summarizes an owner SMS and drafts a concise same-language reply', async () => {
  let captured;
  const result = await analyzeBusinessSms({ text: 'Near the market; open at 7am', business, language: 'en' }, {
    env: { GEMINI_API_KEY: 'server-only-secret', BIZPOA_AI_MODEL: 'gemini-test-model' },
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return providerResponse(response);
    },
  });
  assert.deepEqual(result, { ok: true, analysis: response });
  assert.equal(captured.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent');
  assert.equal(captured.options.headers['x-goog-api-key'], 'server-only-secret');
  const body = JSON.parse(captured.options.body);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.match(JSON.stringify(body), /Near the market/);
  assert.match(body.systemInstruction.parts[0].text, /Never create, edit, or claim/);
});

test('SMS AI refuses missing keys, unverified businesses, oversized text, and unsafe output', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return providerResponse(response); };
  assert.deepEqual(await analyzeBusinessSms({ text: 'hello', business }, { env: {}, fetchImpl }), {
    ok: false, reason: 'missing_ai_key',
  });
  assert.deepEqual(await analyzeBusinessSms({ text: 'hello', business: null }, {
    env: { GEMINI_API_KEY: 'secret' }, fetchImpl,
  }), { ok: false, reason: 'unknown_business' });
  assert.deepEqual(await analyzeBusinessSms({ text: 'x'.repeat(1001), business }, {
    env: { GEMINI_API_KEY: 'secret' }, fetchImpl,
  }), { ok: false, reason: 'message_too_long' });
  const invalid = await analyzeBusinessSms({ text: 'hello', business }, {
    env: { GEMINI_API_KEY: 'secret' },
    fetchImpl: async () => providerResponse({ ...response, reply: 'x'.repeat(281) }),
  });
  assert.deepEqual(invalid, { ok: false, reason: 'ai_invalid_response' });
  assert.equal(calls, 0);
});

test('SMS AI fallback is branded and does not claim a transaction was saved', () => {
  assert.match(fallbackSmsReply({ business: { name: 'Amina Shop' }, language: 'en' }), /Bizpoa: Your message for Amina Shop was received/);
  assert.match(fallbackSmsReply({ business: { name: 'Duka' }, language: 'sw' }), /Bizpoa: Ujumbe wako/);
});
