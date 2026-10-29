import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

const OTP_TTL_MS = 5 * 60 * 1000;
const OWNER_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const OTP_COOLDOWN_MS = 60 * 1000;
const MAX_OTP_REQUESTS_PER_DAY = 5;
const MAX_OTP_ATTEMPTS = 5;

export function normalizePhoneNumber(value) {
  const raw = String(value ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits || digits.length < 9 || digits.length > 15) return null;
  if (raw.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('254')) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 10) return `+254${digits.slice(1)}`;
  return `+${digits}`;
}

function challengeKey(businessCode, phoneNumber) {
  return `${businessCode}:${phoneNumber}`;
}

function hashOtp(code, businessCode, secret) {
  return createHmac('sha256', secret).update(`${businessCode}:${code}`).digest('hex');
}

function equalHex(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ''), 'hex');
  const rightBuffer = Buffer.from(String(right ?? ''), 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function signOwnerPayload(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyOwnerSessionToken(token, secret, now = Date.now()) {
  if (typeof secret !== 'string' || secret.length < 32 || typeof token !== 'string' || token.length > 2048) return null;
  const separator = token.lastIndexOf('.');
  if (separator < 1) return null;
  const encoded = token.slice(0, separator);
  const supplied = Buffer.from(token.slice(separator + 1));
  const expected = Buffer.from(createHmac('sha256', secret).update(encoded).digest('base64url'));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!/^BZ-[A-Z0-9]{6}$/.test(payload.businessCode)
      || typeof payload.phoneNumber !== 'string'
      || !Number.isInteger(payload.expiresAt)
      || payload.expiresAt < Math.floor(now / 1000)) return null;
    return { businessCode: payload.businessCode, phoneNumber: payload.phoneNumber, expiresAt: payload.expiresAt };
  } catch {
    return null;
  }
}

export async function createOwnerOtp({ businessCode, phoneNumber }, {
  store,
  env = process.env,
  now = Date.now(),
  createCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0'),
} = {}) {
  const secret = env.BIZPOA_OWNER_SESSION_SECRET;
  const normalizedCode = String(businessCode ?? '').trim().toUpperCase();
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  if (typeof secret !== 'string' || secret.length < 32) return { ok: false, reason: 'auth_not_configured' };
  if (!/^BZ-[A-Z0-9]{6}$/.test(normalizedCode) || !normalizedPhone) return { ok: false, reason: 'invalid_input' };

  const business = await store.read((database) => Object.values(database.businesses ?? {}).find((item) =>
    item.code === normalizedCode && normalizePhoneNumber(item.phoneNumber) === normalizedPhone));
  if (!business) return { ok: false, reason: 'owner_not_found' };

  const key = challengeKey(normalizedCode, normalizedPhone);
  const code = createCode();
  const result = await store.transact((database) => {
    database.ownerOtpChallenges ??= {};
    database.ownerOtpRateLimits ??= {};
    const rateLimit = database.ownerOtpRateLimits[key] ?? { requestTimes: [], lastSentAt: 0 };
    const requests = (rateLimit.requestTimes ?? []).filter((timestamp) => now - timestamp < 24 * 60 * 60 * 1000);
    if (rateLimit.lastSentAt && now - rateLimit.lastSentAt < OTP_COOLDOWN_MS) return { ok: false, reason: 'rate_limited' };
    if (requests.length >= MAX_OTP_REQUESTS_PER_DAY) return { ok: false, reason: 'rate_limited' };
    database.ownerOtpRateLimits[key] = { requestTimes: [...requests, now], lastSentAt: now };
    database.ownerOtpChallenges[key] = {
      codeHash: hashOtp(code, normalizedCode, secret),
      expiresAt: now + OTP_TTL_MS,
      sentAt: now,
      attempts: 0,
    };
    return { ok: true };
  });
  if (!result.ok) return result;
  return { ok: true, code, business: { code: business.code, name: business.name }, phoneNumber: normalizedPhone };
}

export async function clearOwnerOtp({ businessCode, phoneNumber }, store) {
  const key = challengeKey(String(businessCode ?? '').trim().toUpperCase(), normalizePhoneNumber(phoneNumber) ?? '');
  await store.transact((database) => { delete database.ownerOtpChallenges?.[key]; });
}

export async function verifyOwnerOtp({ businessCode, phoneNumber, code }, {
  store,
  env = process.env,
  now = Date.now(),
} = {}) {
  const secret = env.BIZPOA_OWNER_SESSION_SECRET;
  const normalizedCode = String(businessCode ?? '').trim().toUpperCase();
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  const submittedCode = String(code ?? '').trim();
  if (typeof secret !== 'string' || secret.length < 32) return { ok: false, reason: 'auth_not_configured' };
  if (!/^BZ-[A-Z0-9]{6}$/.test(normalizedCode) || !normalizedPhone || !/^\d{6}$/.test(submittedCode)) {
    return { ok: false, reason: 'invalid_code' };
  }

  const verification = await store.transact((database) => {
    database.ownerOtpChallenges ??= {};
    const key = challengeKey(normalizedCode, normalizedPhone);
    const challenge = database.ownerOtpChallenges[key];
    if (!challenge || challenge.expiresAt < now || challenge.attempts >= MAX_OTP_ATTEMPTS) {
      delete database.ownerOtpChallenges[key];
      return { ok: false, reason: 'invalid_code' };
    }
    const suppliedHash = hashOtp(submittedCode, normalizedCode, secret);
    if (!equalHex(suppliedHash, challenge.codeHash)) {
      challenge.attempts += 1;
      if (challenge.attempts >= MAX_OTP_ATTEMPTS) delete database.ownerOtpChallenges[key];
      return { ok: false, reason: 'invalid_code' };
    }
    delete database.ownerOtpChallenges[key];
    const business = Object.values(database.businesses ?? {}).find((item) =>
      item.code === normalizedCode && normalizePhoneNumber(item.phoneNumber) === normalizedPhone);
    return business
      ? { ok: true, business: { code: business.code, name: business.name, phoneNumber: normalizedPhone } }
      : { ok: false, reason: 'owner_not_found' };
  });
  if (!verification.ok) return verification;

  const expiresAt = Math.floor((now + OWNER_SESSION_TTL_MS) / 1000);
  const accessToken = signOwnerPayload({
    businessCode: normalizedCode,
    phoneNumber: normalizedPhone,
    expiresAt,
  }, secret);
  return { ok: true, accessToken, expiresAt, business: verification.business };
}
