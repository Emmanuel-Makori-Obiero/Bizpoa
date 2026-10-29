import { createHmac, timingSafeEqual } from 'node:crypto';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 365;

export function statementLinkConfigured({ publicUrl, secret } = {}) {
  if (typeof secret !== 'string' || secret.length < 32 || !publicUrl) return false;
  try {
    const base = new URL(publicUrl);
    return base.protocol === 'https:' || (base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname));
  } catch {
    return false;
  }
}

export function statementWindow(days, now = new Date()) {
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) return null;
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function transactionsFor(database, business, days, now = new Date()) {
  const window = statementWindow(days, now);
  if (!window || !business) return { window, transactions: [] };
  const transactions = (database.transactions ?? []).filter((transaction) => {
    const belongs = transaction.businessCode === business.code
      || (!transaction.businessCode && transaction.phoneNumber === business.phoneNumber);
    return belongs && transaction.date >= window.start && transaction.date <= window.end;
  }).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return { window, transactions };
}

function safeCsvCell(value) {
  let text = String(value ?? '');
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildStatementCsv(database, { businessCode, days }, now = new Date()) {
  const business = Object.values(database.businesses ?? {}).find((item) => item.code === businessCode);
  if (!business) return null;
  const { window, transactions } = transactionsFor(database, business, days, now);
  if (!window) return null;
  const sales = transactions.filter((item) => item.type === 'sale').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const expenses = transactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const lines = [
    ['Bizpoa statement', business.name],
    ['Bizpoa ID', business.code],
    ['Period start', window.start],
    ['Period end', window.end],
    [],
    ['Date', 'Type', 'Amount (KES)', 'Reference'],
    ...transactions.map((item) => [item.date || '', item.type || '', Number(item.amount || 0).toFixed(2), item.id || '']),
    [],
    ['Total sales (KES)', sales.toFixed(2)],
    ['Total expenses (KES)', expenses.toFixed(2)],
    ['Net (KES)', (sales - expenses).toFixed(2)],
  ];
  return `\uFEFF${lines.map((row) => row.map(safeCsvCell).join(',')).join('\r\n')}\r\n`;
}

export function formatStatementSms(database, business, days, language = 'en', now = new Date()) {
  const { window, transactions } = transactionsFor(database, business, days, now);
  if (!window) return null;
  const sales = transactions.filter((item) => item.type === 'sale').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const expenses = transactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const net = sales - expenses;
  const period = language === 'sw'
    ? `${days} siku (${window.start} hadi ${window.end})`
    : `${days} days (${window.start} to ${window.end})`;
  const entries = transactions.slice(-5).reverse().map((item) =>
    `${item.date}: ${item.type === 'sale' ? (language === 'sw' ? 'Mauzo' : 'Sale') : (language === 'sw' ? 'Matumizi' : 'Expense')} KES ${Number(item.amount).toFixed(2)}`,
  );
  const header = language === 'sw'
    ? `Bizpoa taarifa ${business.code} - ${period}. Mauzo KES ${sales.toFixed(2)}; matumizi KES ${expenses.toFixed(2)}; salio KES ${net.toFixed(2)}.`
    : `Bizpoa statement ${business.code} - ${period}. Sales KES ${sales.toFixed(2)}; expenses KES ${expenses.toFixed(2)}; net KES ${net.toFixed(2)}.`;
  const detail = entries.length
    ? `${language === 'sw' ? 'Miamala ya hivi karibuni' : 'Recent entries'}: ${entries.join('; ')}.`
    : (language === 'sw' ? 'Hakuna miamala katika kipindi hiki.' : 'No transactions in this period.');
  return `${header} ${detail}`.slice(0, 1200);
}

export function createStatementDownloadUrl({ businessCode, phoneNumber, days, publicUrl, secret, now = Date.now(), ttlMs = DAY_MS }) {
  if (!statementLinkConfigured({ publicUrl, secret }) || !/^BZ-[A-Z0-9]{6}$/.test(String(businessCode ?? '')) || !Number.isInteger(days) || days < 1 || days > MAX_DAYS) return null;
  const base = new URL(publicUrl);
  const payload = Buffer.from(JSON.stringify({
    businessCode,
    days,
    expiresAt: Math.floor((now + ttlMs) / 1000),
  })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${base.toString().replace(/\/$/, '')}/statement/${payload}.${signature}.csv`;
}

export function verifyStatementDownloadToken(token, secret, now = Date.now()) {
  if (typeof secret !== 'string' || secret.length < 32 || typeof token !== 'string' || token.length > 2048) return null;
  const separator = token.lastIndexOf('.');
  if (separator < 1) return null;
  const payloadPart = token.slice(0, separator);
  const receivedSignature = Buffer.from(token.slice(separator + 1));
  const expectedSignature = Buffer.from(createHmac('sha256', secret).update(payloadPart).digest('base64url'));
  if (receivedSignature.length !== expectedSignature.length || !timingSafeEqual(receivedSignature, expectedSignature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    if (!/^BZ-[A-Z0-9]{6}$/.test(payload.businessCode)
      || !Number.isInteger(payload.days) || payload.days < 1 || payload.days > MAX_DAYS
      || !Number.isInteger(payload.expiresAt) || payload.expiresAt < Math.floor(now / 1000)) return null;
    return { businessCode: payload.businessCode, days: payload.days };
  } catch {
    return null;
  }
}
