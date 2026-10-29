import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseStore } from '../src/supabase-storage.js';

const secretKey = 'sb_secret_test_only_not_a_real_project_key';
const env = { SUPABASE_URL: 'https://bizpoa-test.supabase.co', SUPABASE_SECRET_KEY: secretKey };

function response(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function emptyState(revision = 0) {
  return {
    revision,
    users: {},
    sessions: {},
    transactions: [],
    businesses: {},
    smsNotes: [],
    ownerOtpChallenges: {},
    ownerOtpRateLimits: {},
  };
}

test('Supabase storage rejects public browser keys for the server-side database adapter', () => {
  assert.throws(() => createSupabaseStore({
    env: { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public_key' },
  }), /server-only Supabase secret key/);
  assert.throws(() => createSupabaseStore({
    env: { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SECRET_KEY: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.signature' },
  }), /server-only Supabase secret key/);
});

test('Supabase storage reads one consistent state snapshot through the private RPC', async () => {
  const state = emptyState();
  state.businesses['+254700000001'] = {
    code: 'BZ-ABC123', name: 'Amina Shop', phoneNumber: '+254700000001',
  };
  const requests = [];
  const store = createSupabaseStore({
    env,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return response(state);
    },
  });

  const business = await store.read((database) => database.businesses['+254700000001']);
  assert.equal(business.code, 'BZ-ABC123');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `${env.SUPABASE_URL}/rest/v1/rpc/bizpoa_read_state`);
  assert.equal(requests[0].options.headers.apikey, secretKey);
  assert.equal(requests[0].options.headers.Authorization, `Bearer ${secretKey}`);
  assert.deepEqual(JSON.parse(requests[0].options.body), {});
});

test('Supabase storage writes normalized table deltas atomically through the revision RPC', async () => {
  const state = emptyState();
  const requests = [];
  const store = createSupabaseStore({
    env,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/bizpoa_read_state')) return response(state);
      const call = JSON.parse(options.body);
      assert.equal(call.p_expected_revision, state.revision);
      const business = call.p_delta.businesses_upsert[0];
      state.businesses[business.phone_number] = {
        code: business.code,
        name: business.name,
        category: business.category,
        categoryLabel: business.category_label,
        type: business.type,
        phoneNumber: business.phone_number,
        registeredAt: business.registered_at,
        updatedAt: business.updated_at,
      };
      state.revision += 1;
      return response({ conflict: false, revision: state.revision });
    },
  });

  const result = await store.transact((database) => {
    database.businesses['+254700000001'] = {
      code: 'BZ-ABC123',
      name: 'Amina Shop',
      category: 'retail',
      categoryLabel: 'Retail / shop',
      type: 'Shopkeeper',
      phoneNumber: '+254700000001',
      registeredAt: '2026-10-29T12:00:00.000Z',
      updatedAt: '2026-10-29T12:00:00.000Z',
    };
    return 'saved';
  });

  assert.equal(result, 'saved');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, `${env.SUPABASE_URL}/rest/v1/rpc/bizpoa_apply_state_delta`);
  const call = JSON.parse(requests[1].options.body);
  assert.equal(call.p_expected_revision, 0);
  assert.equal(call.p_delta.businesses_upsert.length, 1);
  assert.equal(call.p_delta.businesses_upsert[0].code, 'BZ-ABC123');
  assert.deepEqual(call.p_delta.businesses_delete, []);
  assert.equal(state.revision, 1);
});

test('Supabase storage maps every application collection to its relational delta fields', async () => {
  const requests = [];
  const store = createSupabaseStore({
    env,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/bizpoa_read_state')) return response(emptyState());
      return response({ conflict: false, revision: 1 });
    },
  });
  const phoneNumber = '+254700000001';
  const challengeKey = 'BZ-ABC123:+254700000001';

  await store.transact((database) => {
    database.businesses[phoneNumber] = {
      code: 'BZ-ABC123', name: 'Amina Shop', phoneNumber,
      registeredAt: '2026-10-29T12:00:00.000Z', updatedAt: '2026-10-29T12:00:00.000Z',
    };
    database.users[phoneNumber] = { language: 'sw', updatedAt: '2026-10-29T12:00:00.000Z' };
    database.sessions['USSD-SESSION-1'] = { phoneNumber, stage: 'main', consumed: 0 };
    database.transactions.push({
      id: 'USSD-SESSION-1-1', phoneNumber, businessCode: 'BZ-ABC123',
      type: 'sale', amount: 320, date: '2026-10-29', createdAt: '2026-10-29T12:00:00.000Z',
    });
    database.smsNotes.push({
      id: '00000000-0000-4000-8000-000000000001', phoneNumber, businessCode: 'BZ-ABC123',
      text: 'opens at 7am', messageId: 'AT-MESSAGE-1', aiTopic: 'hours',
      aiSummary: 'Shop opens at 7am.', aiReply: 'Thanks, noted.', receivedAt: '2026-10-29T12:00:00.000Z',
    });
    database.ownerOtpChallenges[challengeKey] = {
      codeHash: 'a'.repeat(64), expiresAt: 1793265900000, sentAt: 1793265600000, attempts: 1,
    };
    database.ownerOtpRateLimits[challengeKey] = {
      requestTimes: [1793265600000], lastSentAt: 1793265600000,
    };
  });

  const call = JSON.parse(requests[1].options.body);
  const delta = call.p_delta;
  assert.equal(delta.businesses_upsert[0].phone_number, phoneNumber);
  assert.equal(delta.users_upsert[0].language, 'sw');
  assert.equal(delta.sessions_upsert[0].session_id, 'USSD-SESSION-1');
  assert.equal(delta.sessions_upsert[0].payload.stage, 'main');
  assert.equal(delta.transactions_upsert[0].business_code, 'BZ-ABC123');
  assert.equal(delta.transactions_upsert[0].amount, 320);
  assert.equal(delta.sms_notes_upsert[0].message_id, 'AT-MESSAGE-1');
  assert.equal(delta.sms_notes_upsert[0].ai_summary, 'Shop opens at 7am.');
  assert.equal(delta.otp_challenges_upsert[0].challenge_key, challengeKey);
  assert.equal(delta.otp_rate_limits_upsert[0].last_sent_at_ms, 1793265600000);
});

test('Supabase storage reloads and retries a transaction after another instance commits first', async () => {
  const state = emptyState();
  let applyCount = 0;
  let operationCount = 0;
  const store = createSupabaseStore({
    env,
    fetchImpl: async (url, options) => {
      if (url.endsWith('/bizpoa_read_state')) return response(state);
      applyCount += 1;
      const call = JSON.parse(options.body);
      if (applyCount === 1) {
        state.revision += 1;
        state.users['+254700000002'] = { language: 'sw', updatedAt: '2026-10-29T12:00:00.000Z' };
        return response({ conflict: true, revision: state.revision });
      }
      assert.equal(call.p_expected_revision, state.revision);
      const user = call.p_delta.users_upsert[0];
      state.users[user.phone_number] = { language: user.language, updatedAt: user.updated_at };
      state.revision += 1;
      return response({ conflict: false, revision: state.revision });
    },
  });

  await store.transact((database) => {
    operationCount += 1;
    database.users['+254700000001'] = { language: 'en', updatedAt: '2026-10-29T12:01:00.000Z' };
  });

  assert.equal(operationCount, 2);
  assert.equal(applyCount, 2);
  assert.equal(state.revision, 2);
  assert.equal(state.users['+254700000001'].language, 'en');
  assert.equal(state.users['+254700000002'].language, 'sw');
});
