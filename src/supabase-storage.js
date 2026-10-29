import { randomUUID } from 'node:crypto';

const TABLE_PREFIX = 'bizpoa_';
const MAX_TRANSACTION_ATTEMPTS = 5;

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function objectDiff(before = {}, after = {}, toRow = (key, value) => ({ key, value })) {
  const upsert = [];
  const remove = [];
  for (const [key, value] of Object.entries(after ?? {})) {
    if (!Object.hasOwn(before ?? {}, key) || !jsonEqual(before[key], value)) upsert.push(toRow(key, value));
  }
  for (const key of Object.keys(before ?? {})) {
    if (!Object.hasOwn(after ?? {}, key)) remove.push(key);
  }
  return { upsert, remove };
}

function arrayDiff(before = [], after = [], keyOf, toRow) {
  const beforeById = new Map((before ?? []).map((item, index) => [keyOf(item, index), item]));
  const afterById = new Map((after ?? []).map((item, index) => [keyOf(item, index), item]));
  const upsert = [];
  const remove = [];
  for (const [key, item] of afterById) {
    if (!beforeById.has(key) || !jsonEqual(beforeById.get(key), item)) upsert.push(toRow(item));
  }
  for (const key of beforeById.keys()) {
    if (!afterById.has(key)) remove.push(key);
  }
  return { upsert, remove };
}

function stateDelta(before, after) {
  const business = objectDiff(before.businesses, after.businesses, (phoneNumber, item) => ({
    phone_number: item.phoneNumber ?? phoneNumber,
    code: item.code,
    name: item.name,
    category: item.category ?? null,
    category_label: item.categoryLabel ?? null,
    type: item.type ?? null,
    registered_at: item.registeredAt ?? new Date().toISOString(),
    updated_at: item.updatedAt ?? new Date().toISOString(),
  }));
  const user = objectDiff(before.users, after.users, (phoneNumber, item) => ({
    phone_number: phoneNumber,
    language: item.language ?? null,
    updated_at: item.updatedAt ?? new Date().toISOString(),
  }));
  const session = objectDiff(before.sessions, after.sessions, (sessionId, payload) => ({
    session_id: sessionId,
    phone_number: payload.phoneNumber,
    payload,
  }));
  const challenge = objectDiff(before.ownerOtpChallenges, after.ownerOtpChallenges, (challengeKey, item) => ({
    challenge_key: challengeKey,
    code_hash: item.codeHash,
    expires_at_ms: item.expiresAt,
    sent_at_ms: item.sentAt,
    attempts: item.attempts ?? 0,
  }));
  const rateLimit = objectDiff(before.ownerOtpRateLimits, after.ownerOtpRateLimits, (challengeKey, item) => ({
    challenge_key: challengeKey,
    request_times_ms: item.requestTimes ?? [],
    last_sent_at_ms: item.lastSentAt ?? 0,
  }));
  const transaction = arrayDiff(before.transactions, after.transactions,
    (item, index) => String(item.id ?? `legacy-transaction-${index}`), (item) => ({
      id: String(item.id),
      phone_number: item.phoneNumber,
      business_code: item.businessCode ?? null,
      type: item.type,
      amount: item.amount,
      date: item.date,
      created_at: item.createdAt ?? new Date().toISOString(),
    }));
  const note = arrayDiff(before.smsNotes, after.smsNotes,
    (item, index) => String(item.id ?? item.messageId ?? `legacy-note-${index}`), (item) => ({
      id: item.id ?? randomUUID(),
      phone_number: item.phoneNumber,
      business_code: item.businessCode ?? null,
      text: item.text,
      message_id: item.messageId ?? null,
      ai_topic: item.aiTopic ?? null,
      ai_summary: item.aiSummary ?? null,
      ai_reply: item.aiReply ?? null,
      received_at: item.receivedAt ?? new Date().toISOString(),
    }));

  const delta = {
    businesses_upsert: business.upsert,
    businesses_delete: business.remove,
    users_upsert: user.upsert,
    users_delete: user.remove,
    sessions_upsert: session.upsert,
    sessions_delete: session.remove,
    transactions_upsert: transaction.upsert,
    transactions_delete: transaction.remove,
    sms_notes_upsert: note.upsert,
    sms_notes_delete: note.remove,
    otp_challenges_upsert: challenge.upsert,
    otp_challenges_delete: challenge.remove,
    otp_rate_limits_upsert: rateLimit.upsert,
    otp_rate_limits_delete: rateLimit.remove,
  };
  return Object.values(delta).some((items) => items.length > 0) ? delta : null;
}

function validServerKey(key) {
  if (typeof key !== 'string' || !key.trim()) return false;
  const value = key.trim();
  if (value.startsWith('sb_secret_')) return true;
  if (value.startsWith('sb_publishable_')) return false;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

function normalizeState(state) {
  if (!state || typeof state !== 'object' || !Number.isSafeInteger(Number(state.revision))) {
    throw new Error('Supabase returned an invalid Bizpoa state snapshot.');
  }
  return {
    revision: Number(state.revision),
    users: state.users && typeof state.users === 'object' ? state.users : {},
    sessions: state.sessions && typeof state.sessions === 'object' ? state.sessions : {},
    transactions: Array.isArray(state.transactions) ? state.transactions : [],
    businesses: state.businesses && typeof state.businesses === 'object' ? state.businesses : {},
    smsNotes: Array.isArray(state.smsNotes) ? state.smsNotes : [],
    ownerOtpChallenges: state.ownerOtpChallenges && typeof state.ownerOtpChallenges === 'object' ? state.ownerOtpChallenges : {},
    ownerOtpRateLimits: state.ownerOtpRateLimits && typeof state.ownerOtpRateLimits === 'object' ? state.ownerOtpRateLimits : {},
  };
}

export function createSupabaseStore({ env = process.env, fetchImpl = fetch } = {}) {
  const projectUrl = String(env.SUPABASE_URL ?? '').trim().replace(/\/$/, '');
  const secretKey = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!projectUrl || !/^https:\/\//i.test(projectUrl)) throw new Error('SUPABASE_URL must be an HTTPS project URL.');
  if (!validServerKey(secretKey)) {
    throw new Error('Set SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) to a server-only Supabase secret key.');
  }

  let writeQueue = Promise.resolve();

  async function rpc(functionName, parameters = {}) {
    let response;
    try {
      response = await fetchImpl(`${projectUrl}/rest/v1/rpc/${functionName}`, {
        method: 'POST',
        headers: {
          apikey: secretKey,
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(parameters),
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new Error('Could not connect to the Bizpoa Supabase database.');
    }
    if (!response.ok) throw new Error(`Bizpoa Supabase RPC failed (${response.status}).`);
    try {
      return await response.json();
    } catch {
      throw new Error('Bizpoa Supabase returned an invalid response.');
    }
  }

  async function loadState() {
    return normalizeState(await rpc('bizpoa_read_state'));
  }

  return {
    read(operation) {
      return loadState().then((database) => operation(database));
    },
    transact(operation) {
      const result = writeQueue.then(async () => {
        for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
          const before = await loadState();
          const after = structuredClone(before);
          const value = await operation(after);
          const delta = stateDelta(before, after);
          if (!delta) return value;
          const result = await rpc('bizpoa_apply_state_delta', {
            p_expected_revision: before.revision,
            p_delta: delta,
          });
          if (!result?.conflict) return value;
        }
        throw new Error('Supabase state changed too frequently; please retry the request.');
      });
      writeQueue = result.catch(() => {});
      return result;
    },
  };
}

export const supabaseStorageTables = Object.freeze([
  `${TABLE_PREFIX}businesses`, `${TABLE_PREFIX}transactions`, `${TABLE_PREFIX}sms_notes`,
  `${TABLE_PREFIX}users`, `${TABLE_PREFIX}ussd_sessions`,
  `${TABLE_PREFIX}owner_otp_challenges`, `${TABLE_PREFIX}owner_otp_rate_limits`,
]);
