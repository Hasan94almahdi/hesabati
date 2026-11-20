const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

test('income journal is balanced and increases the cash account', () => {
  const journal = Core.incomeJournal({
    id: 'income-1', amount: 250.75, account_id: 'cash', currency: 'TRY',
    date: '2026-11-01', description: 'Sale'
  });
  assert.equal(Core.assertBalanced(journal.entries), true);
  assert.equal(Core.accountBalance('cash', [journal]), 250.75);
  assert.deepEqual(Core.journalFlow(journal), { income: 250.75, expense: 0, profit: 250.75, currency: 'TRY' });
});

test('expense journal is balanced and reduces the selected account', () => {
  const journal = Core.expenseJournal({
    amount: 80.25, account_id: 'bank', currency: 'TRY',
    date: '2026-11-02', description: 'Supplies'
  });
  assert.equal(Core.accountBalance('bank', [journal]), -80.25);
  assert.deepEqual(Core.journalFlow(journal), { income: 0, expense: 80.25, profit: -80.25, currency: 'TRY' });
});

test('same-currency transfer moves value without changing income or expense', () => {
  const journal = Core.transferJournal({
    amount: 40, from_account_id: 'cash', to_account_id: 'bank',
    currency: 'TRY', date: '2026-11-03'
  });
  assert.equal(Core.accountBalance('cash', [journal]), -40);
  assert.equal(Core.accountBalance('bank', [journal]), 40);
  assert.deepEqual(Core.journalFlow(journal), { income: 0, expense: 0, profit: 0, currency: 'TRY' });
});

test('foreign-exchange transfer balances each currency independently', () => {
  const journal = Core.fxTransferJournal({
    from_amount: 100, to_amount: 3400,
    from_account_id: 'usd', to_account_id: 'try',
    from_currency: 'USD', to_currency: 'TRY', date: '2026-11-03'
  });
  assert.deepEqual(Core.balanceByCurrency(journal.entries), {
    USD: { debit: 100, credit: 100, difference: 0 },
    TRY: { debit: 3400, credit: 3400, difference: 0 }
  });
  assert.equal(Core.accountBalance('usd', [journal]), -100);
  assert.equal(Core.accountBalance('try', [journal]), 3400);
});

test('order metrics keep value, cash, costs and profit separate', () => {
  const order = { id: 'o1', amount: 5000 };
  const payments = [{ order_id: 'o1', amount: 1200 }, { order_id: 'o1', amount: 800 }];
  const costs = [
    { order_id: 'o1', amount: 900, paid_amount: 900 },
    { order_id: 'o1', amount: 300, paid_amount: 100 }
  ];
  assert.deepEqual(Core.orderMetrics(order, payments, costs), {
    total: 5000, paid: 2000, due: 3000, total_costs: 1200,
    unpaid_costs: 200, expected_profit: 3800, cash_profit: 1000
  });
});

test('partial debt settlements reduce the balance without going below zero', () => {
  const debt = { id: 'd1', amount: 1000 };
  assert.equal(Core.debtBalance(debt, [{ debt_id: 'd1', amount: 250 }, { debt_id: 'd1', amount: 300 }]), 450);
  assert.equal(Core.debtBalance({ ...debt, legacy_settled: true }, []), 0);
});

test('exchange rate resolver supports direct, inverse, dated and chained rates', () => {
  const rates = [
    { from_currency: 'USD', to_currency: 'TRY', rate: 30, date: '2026-01-01', created_at: '2026-01-01T00:00:00Z' },
    { from_currency: 'USD', to_currency: 'TRY', rate: 34, date: '2026-06-01', created_at: '2026-06-01T00:00:00Z' },
    { from_currency: 'EUR', to_currency: 'USD', rate: 1.1, date: '2026-01-01', created_at: '2026-01-01T00:00:00Z' }
  ];
  assert.equal(Core.exchangeRate('USD', 'TRY', '2026-03-01', rates), 30);
  assert.equal(Core.exchangeRate('USD', 'TRY', '2026-07-01', rates), 34);
  assert.equal(Core.round(Core.exchangeRate('TRY', 'USD', '2026-07-01', rates)), 0.03);
  assert.equal(Core.convertAmount(10, 'EUR', 'TRY', '2026-07-01', rates), 374);
  assert.equal(Core.exchangeRate('SYP', 'TRY', '2026-07-01', rates), null);
});

test('daily, monthly and yearly report bounds include the correct dates', () => {
  assert.deepEqual(Core.periodBounds('day', '2026-11-21'), { from: '2026-11-21', to: '2026-11-21' });
  assert.deepEqual(Core.periodBounds('month', '2026-02-12'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(Core.periodBounds('year', '2026-11-21'), { from: '2026-01-01', to: '2026-12-31' });
});

test('reports convert currencies, respect scope and flag missing rates', () => {
  const journals = [
    Core.incomeJournal({ id: 'i1', amount: 100, account_id: 'cash', currency: 'TRY', date: '2026-11-01', scope: 'work' }),
    Core.expenseJournal({ id: 'e1', amount: 20, account_id: 'cash', currency: 'TRY', date: '2026-11-02', scope: 'work' }),
    Core.incomeJournal({ id: 'i2', amount: 10, account_id: 'usd', currency: 'USD', date: '2026-11-02', scope: 'work' }),
    Core.expenseJournal({ id: 'e2', amount: 5, account_id: 'eur', currency: 'EUR', date: '2026-11-02', scope: 'personal' })
  ];
  const rates = [{ from_currency: 'USD', to_currency: 'TRY', rate: 34, date: '2026-01-01', created_at: '2026-01-01T00:00:00Z' }];
  const report = Core.reportTotals(journals, rates, 'TRY', { from: '2026-11-01', to: '2026-11-30' }, 'work');
  assert.equal(report.income, 440);
  assert.equal(report.expense, 20);
  assert.equal(report.profit, 420);
  assert.equal(report.missing_rates.length, 0);
  const all = Core.reportTotals(journals, rates, 'TRY', { from: '2026-11-01', to: '2026-11-30' }, 'all');
  assert.equal(all.missing_rates.length, 1);
});

test('reversal journal makes the selected account net to zero', () => {
  const original = Core.incomeJournal({ amount: 200, account_id: 'cash', currency: 'TRY', date: '2026-11-01' });
  const reversal = Core.reverseJournal(original, '2026-11-02T10:00:00Z');
  assert.equal(Core.accountBalance('cash', [original, reversal]), 0);
  assert.equal(reversal.reference_id, original.id);
  assert.equal(Core.assertBalanced(reversal.entries), true);
});

test('unbalanced and invalid journals are rejected', () => {
  assert.throws(() => Core.createJournal({
    entries: [
      { account_id: 'cash', currency: 'TRY', debit: 100 },
      { account_id: Core.SYSTEM.income, currency: 'TRY', credit: 90 }
    ]
  }), /غير متزنة/);
  assert.throws(() => Core.incomeJournal({ amount: 0, account_id: 'cash', currency: 'TRY' }), /أكبر من صفر/);
});

test('backup validation rejects malformed or unbalanced data', () => {
  assert.throws(() => Core.validateSnapshot({}, ['transactions']), /لا توجد بيانات/);
  assert.throws(() => Core.validateSnapshot({
    data: { transactions: [{ id: 'bad', journal_version: 1, entries: [
      { account_id: 'cash', currency: 'TRY', debit: 10, credit: 0 },
      { account_id: 'income', currency: 'TRY', debit: 0, credit: 9 }
    ] }] }
  }, ['transactions']), /غير متزنة/);
});
