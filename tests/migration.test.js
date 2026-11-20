const test = require('node:test');
const assert = require('node:assert/strict');

const Core = require('../core.js');
global.window = global;
global.HesabatiCore = Core;
require('../db.js');
const DB = global.HesabatiDB;

test('legacy 0.2 income and expense records become balanced journals', () => {
  const income = Core.migrateLegacyTransaction({
    id: 'old-income', type: 'income', amount: '125.50', currency: 'TRY',
    account: 'cash', scope: 'work', note: 'قديم', created_at: '2025-01-02T10:00:00Z'
  });
  assert.equal(income.id, 'old-income');
  assert.equal(income.kind, 'legacy_income');
  assert.equal(income.description, 'قديم');
  assert.equal(Core.accountBalance('cash', [income]), 125.5);
  assert.equal(Core.assertBalanced(income.entries), true);

  const expense = Core.migrateLegacyTransaction({
    id: 'old-expense', type: 'expense', amount: 25, currency: 'TRY',
    account: 'bank', scope: 'home', created_at: '2025-01-03T10:00:00Z'
  });
  assert.equal(expense.kind, 'legacy_expense');
  assert.equal(Core.accountBalance('bank', [expense]), -25);
  assert.equal(Core.assertBalanced(expense.entries), true);
});

test('full legacy dataset normalization preserves records and adds idempotent journals', () => {
  const legacy = {
    customers: [{ id: 'c1', name: 'عميل قديم', phone: '123' }],
    orders: [{ id: 'o1', customer_id: 'c1', title: 'طلب قديم', amount: '500', currency: 'TRY', created_at: '2025-01-01T00:00:00Z' }],
    accounts: [{ id: 'usd-wallet', name: 'دولار', currency: 'USD', opening: '50', scope: 'work', created_at: '2025-01-01T00:00:00Z' }],
    transactions: [{ id: 't1', type: 'income', amount: '100', currency: 'TRY', account: 'cash', scope: 'work', created_at: '2025-01-02T00:00:00Z' }],
    transfers: [{ id: 'x1', from: 'cash', to: 'bank', amount: '20', currency: 'TRY', created_at: '2025-01-03T00:00:00Z' }],
    debts: [{ id: 'd1', title: 'دين قديم', amount: '40', currency: 'TRY', kind: 'receivable', settled: false }]
  };
  const normalized = DB.normalizeLegacyData(legacy);

  assert.ok(normalized.accounts.some(account => account.id === 'cash'));
  assert.ok(normalized.accounts.some(account => account.id === 'bank'));
  assert.ok(normalized.accounts.some(account => account.id === Core.SYSTEM.income));
  assert.equal(normalized.accounts.find(account => account.id === 'usd-wallet').opening, 0);
  assert.equal(normalized.accounts.find(account => account.id === 'usd-wallet').legacy_opening, 50);

  assert.ok(normalized.transactions.some(tx => tx.id === 't1' && tx.kind === 'legacy_income'));
  assert.ok(normalized.transactions.some(tx => tx.id === 'migration:transfer:x1'));
  assert.ok(normalized.transactions.some(tx => tx.id === 'migration:opening:usd-wallet'));
  for (const transaction of normalized.transactions) assert.equal(Core.assertBalanced(transaction.entries), true);

  assert.equal(normalized.orders[0].amount, 500);
  assert.equal(normalized.orders[0].title, 'طلب قديم');
  assert.equal(normalized.debts[0].amount, 40);
  assert.ok(normalized.categories.length >= 7);

  const secondPass = DB.normalizeLegacyData({ ...legacy, ...normalized, transfers: legacy.transfers });
  assert.equal(secondPass.transactions.filter(tx => tx.id === 'migration:transfer:x1').length, 1);
  assert.equal(secondPass.transactions.filter(tx => tx.id === 'migration:opening:usd-wallet').length, 1);
});

test('settled legacy debt stays settled without inventing a cash movement', () => {
  const normalized = DB.normalizeLegacyData({ debts: [{ id: 'd2', title: 'مسدد سابقاً', amount: 100, settled: true }] });
  assert.equal(normalized.debts[0].legacy_settled, true);
  assert.equal(normalized.debts[0].status, 'legacy_settled');
  assert.equal(Core.debtBalance(normalized.debts[0], []), 0);
});

test('integrity report detects broken links and duplicate identifiers', () => {
  const journal = Core.incomeJournal({ id: 'j1', amount: 10, account_id: 'cash', currency: 'TRY' });
  const report = Core.integrityReport({
    customers: [],
    orders: [{ id: 'o1', customer_id: 'missing' }, { id: 'o1', customer_id: '' }],
    transactions: [journal]
  });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some(issue => issue.type === 'missing_customer'));
  assert.ok(report.issues.some(issue => issue.type === 'duplicate_id'));
});
