import test from 'node:test';
import assert from 'node:assert/strict';
import { sendSms, registrationSms, detailsSavedSms } from '../src/africastalking.js';

test('SMS sender uses the sandbox endpoint and sandbox username by default', async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({
      SMSMessageData: {
        Message: 'Sent to 1/1',
        Recipients: [{ number: '+254700000001', status: 'Success', statusCode: 101, messageId: 'test-id' }],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const result = await sendSms({ to: '+254700000001', message: 'Bizpoa test' }, {
    env: { AT_API_KEY: 'test-secret' },
    fetchImpl,
  });

  assert.equal(result.sent, true);
  assert.equal(result.messageId, 'test-id');
  assert.equal(captured.url, 'https://api.sandbox.africastalking.com/version1/messaging');
  assert.equal(captured.options.headers.apiKey, 'test-secret');
  assert.equal(captured.options.body.get('username'), 'sandbox');
  assert.equal(captured.options.body.get('to'), '+254700000001');
});

test('SMS sender does not call Africa\'s Talking if no API key is configured', async () => {
  let called = false;
  const result = await sendSms({ to: '+254700000001', message: 'Bizpoa test' }, {
    env: {},
    fetchImpl: async () => { called = true; throw new Error('should not be called'); },
  });
  assert.deepEqual(result, { sent: false, reason: 'missing_api_key' });
  assert.equal(called, false);
});

test('registration and receipt SMS include the business ID and instructions', () => {
  assert.match(registrationSms('BZ-ABC123'), /BZ-ABC123, followed by your message, to 62073/);
  assert.match(registrationSms('BZ-ABC123'), /Use your registered phone/);
  assert.match(detailsSavedSms('BZ-ABC123'), /Details received for BZ-ABC123/);
  assert.match(detailsSavedSms('BZ-ABC123'), /62073/);
});
