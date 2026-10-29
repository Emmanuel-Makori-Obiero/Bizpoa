import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminAuthenticator } from '../src/auth.js';

function makeRequest(token = 'valid-access-token') {
  return { headers: token ? { authorization: `Bearer ${token}` } : {} };
}

const configuredEnv = {
  SUPABASE_URL: 'https://project.supabase.co/',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  BIZPOA_ADMIN_EMAIL: 'owner@example.com',
};

test('Supabase session for the allowlisted admin is accepted', async () => {
  let calledUrl;
  let calledHeaders;
  const authenticate = createAdminAuthenticator({
    env: configuredEnv,
    fetchImpl: async (url, options) => {
      calledUrl = url;
      calledHeaders = options.headers;
      return new Response(JSON.stringify({ id: 'user-1', email: 'OWNER@example.com' }), { status: 200 });
    },
  });
  const result = await authenticate(makeRequest());
  assert.equal(result.ok, true);
  assert.equal(result.user.id, 'user-1');
  assert.equal(calledUrl, 'https://project.supabase.co/auth/v1/user');
  assert.equal(calledHeaders.apikey, 'sb_publishable_test');
  assert.equal(calledHeaders.Authorization, 'Bearer valid-access-token');
});

test('authentication fails closed if Supabase or admin allowlist configuration is missing', async () => {
  let called = false;
  const authenticate = createAdminAuthenticator({
    env: {},
    fetchImpl: async () => { called = true; throw new Error('must not call'); },
  });
  const result = await authenticate(makeRequest());
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.match(result.error, /BIZPOA_ADMIN_EMAIL/);
  assert.equal(called, false);
});

test('authentication rejects missing and expired Supabase sessions', async () => {
  const authenticate = createAdminAuthenticator({
    env: configuredEnv,
    fetchImpl: async () => new Response('{}', { status: 401 }),
  });
  assert.equal((await authenticate(makeRequest(''))).status, 401);
  assert.equal((await authenticate(makeRequest())).status, 401);
});

test('authenticated non-admin accounts are forbidden', async () => {
  const authenticate = createAdminAuthenticator({
    env: configuredEnv,
    fetchImpl: async () => new Response(JSON.stringify({ id: 'user-2', email: 'other@example.com' }), { status: 200 }),
  });
  const result = await authenticate(makeRequest());
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});
