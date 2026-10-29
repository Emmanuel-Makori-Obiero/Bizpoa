import { randomUUID } from 'node:crypto';

const businessCodePattern = /^BZ-[A-Z0-9]{6}$/;

export async function recordVoiceTransaction({ businessCode, type, amount }, store) {
  const normalizedCode = String(businessCode ?? '').trim().toUpperCase();
  const normalizedType = String(type ?? '').trim().toLowerCase();
  const numericAmount = Number(amount);

  if (!businessCodePattern.test(normalizedCode)) return { ok: false, reason: 'invalid_business_code' };
  if (!['sale', 'expense'].includes(normalizedType)) return { ok: false, reason: 'invalid_type' };
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 999_999_999.99) {
    return { ok: false, reason: 'invalid_amount' };
  }
  if (Math.round(numericAmount * 100) !== numericAmount * 100) return { ok: false, reason: 'invalid_amount' };

  return store.transact((database) => {
    const business = Object.values(database.businesses ?? {}).find((item) => item.code === normalizedCode);
    if (!business) return { ok: false, reason: 'unknown_business' };

    const createdAt = new Date().toISOString();
    const transaction = {
      id: randomUUID(),
      phoneNumber: business.phoneNumber,
      businessCode: business.code,
      type: normalizedType,
      amount: numericAmount,
      date: createdAt.slice(0, 10),
      createdAt,
    };
    database.transactions ??= [];
    database.transactions.push(transaction);
    return { ok: true, transaction, business: { code: business.code, name: business.name } };
  });
}
