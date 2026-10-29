import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStatementCsv,
  createStatementDownloadUrl,
  formatStatementSms,
  statementWindow,
  verifyStatementDownloadToken,
} from '../src/statements.js';

const now = new Date('2026-10-29T12:00:00Z');
const secret = 'statement-signing-secret-used-only-for-tests-123456789';
const database = {
  businesses: {
    '+254700000001': { code: 'BZ-ABC123', name: '=Amina Shop', phoneNumber: '+254700000001' },
    '+254700000002': { code: 'BZ-DEF456', name: 'Other Shop', phoneNumber: '+254700000002' },
  },
  transactions: [
    { id: 'sale-a', phoneNumber: '+254700000001', businessCode: 'BZ-ABC123', type: 'sale', amount: 300, date: '2026-10-29', createdAt: '2026-10-29T10:00:00Z' },
    { id: 'legacy-expense', phoneNumber: '+254700000001', businessCode: null, type: 'expense', amount: 50.5, date: '2026-10-01', createdAt: '2026-10-01T10:00:00Z' },
    { id: 'outside-period', phoneNumber: '+254700000001', businessCode: 'BZ-ABC123', type: 'sale', amount: 999, date: '2026-09-01', createdAt: '2026-09-01T10:00:00Z' },
    { id: 'other-business', phoneNumber: '+254700000002', businessCode: 'BZ-DEF456', type: 'sale', amount: 5000, date: '2026-10-29', createdAt: '2026-10-29T11:00:00Z' },
  ],
};

test('statement window validates 1-365 days and uses an inclusive rolling date range', () => {
  assert.deepEqual(statementWindow(30, now), { start: '2026-09-30', end: '2026-10-29' });
  assert.deepEqual(statementWindow(1, now), { start: '2026-10-29', end: '2026-10-29' });
  assert.equal(statementWindow(0, now), null);
  assert.equal(statementWindow(366, now), null);
});

test("CSV statement includes only the owner's ledger, totals and safe spreadsheet cells", () => {
  const csv = buildStatementCsv(database, { businessCode: 'BZ-ABC123', days: 30 }, now);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /'\=Amina Shop/);
  assert.match(csv, /sale-a/);
  assert.match(csv, /legacy-expense/);
  assert.doesNotMatch(csv, /outside-period|other-business|5000/);
  assert.match(csv, /300\.00/);
  assert.match(csv, /50\.50/);
  assert.match(csv, /249\.50/);
  assert.equal(buildStatementCsv(database, { businessCode: 'BZ-XXXXXX', days: 30 }, now), null);
  assert.equal(buildStatementCsv(database, { businessCode: 'BZ-ABC123', days: 366 }, now), null);
});

test('SMS statement summarizes the selected period and latest ledger rows in either language', () => {
  const business = database.businesses['+254700000001'];
  const english = formatStatementSms(database, business, 30, 'en', now);
  assert.match(english, /30 days/);
  assert.match(english, /Sales KES 300\.00/);
  assert.match(english, /expenses KES 50\.50/);
  assert.match(english, /2026-10-29: Sale KES 300\.00/);
  const swahili = formatStatementSms(database, business, 30, 'sw', now);
  assert.match(swahili, /30 siku/);
  assert.match(swahili, /Mauzo KES 300\.00/);
});

test('signed statement link is private to its signed business scope, tamper-evident, and expires', () => {
  const url = createStatementDownloadUrl({
    businessCode: 'BZ-ABC123',
    phoneNumber: '+254700000001',
    days: 30,
    publicUrl: 'https://bizpoa.example/',
    secret,
    now: Date.parse('2026-10-29T12:00:00Z'),
  });
  assert.match(url, /^https:\/\/bizpoa\.example\/statement\/.+\.csv$/);
  const token = url.split('/statement/')[1].replace(/\.csv$/, '');
  assert.deepEqual(verifyStatementDownloadToken(token, secret, Date.parse('2026-10-29T12:01:00Z')),
    { businessCode: 'BZ-ABC123', days: 30 });
  assert.equal(verifyStatementDownloadToken(`${token}x`, secret, Date.parse('2026-10-29T12:01:00Z')), null);
  assert.equal(verifyStatementDownloadToken(token, secret, Date.parse('2026-10-31T12:00:00Z')), null);
  assert.equal(createStatementDownloadUrl({ businessCode: 'BZ-ABC123', phoneNumber: '+254700000001', days: 30, publicUrl: 'http://not-secure.example', secret }), null);
  assert.equal(createStatementDownloadUrl({ businessCode: 'BZ-ABC123', phoneNumber: '+254700000001', days: 30, publicUrl: 'https://bizpoa.example', secret: 'weak' }), null);
});
