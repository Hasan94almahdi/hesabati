(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HesabatiCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const APP_VERSION = '1.0.0';
  const DB_VERSION = 7;
  const EPSILON = 0.000001;
  const CURRENCIES = ['TRY', 'USD', 'EUR', 'SYP'];
  const SYSTEM = Object.freeze({
    income: 'system:income',
    expense: 'system:expense',
    cogs: 'system:cogs',
    equity: 'system:equity',
    receivable: 'system:receivable',
    payable: 'system:payable',
    fx: 'system:fx-clearing'
  });

  const round = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  const toNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const sum = (items, pick = value => value) => round(items.reduce((total, item) => total + toNumber(pick(item)), 0));
  const today = () => {
    const value = new Date();
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  };
  const uid = (prefix = 'id') => `${prefix}:${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

  function positiveAmount(value, label = 'المبلغ') {
    const amount = round(value);
    if (!(amount > 0)) throw new Error(`${label} يجب أن يكون أكبر من صفر`);
    return amount;
  }

  function makeEntry(accountId, currency, debit = 0, credit = 0, memo = '') {
    debit = round(debit);
    credit = round(credit);
    if (!accountId) throw new Error('الحساب مطلوب');
    if (!currency) throw new Error('العملة مطلوبة');
    if (debit < 0 || credit < 0 || (debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
      throw new Error('قيد محاسبي غير صالح');
    }
    return { account_id: accountId, currency, debit, credit, memo };
  }

  function balanceByCurrency(entries) {
    return (entries || []).reduce((result, entry) => {
      const currency = entry.currency || 'UNKNOWN';
      if (!result[currency]) result[currency] = { debit: 0, credit: 0, difference: 0 };
      result[currency].debit = round(result[currency].debit + toNumber(entry.debit));
      result[currency].credit = round(result[currency].credit + toNumber(entry.credit));
      result[currency].difference = round(result[currency].debit - result[currency].credit);
      return result;
    }, {});
  }

  function assertBalanced(entries) {
    if (!Array.isArray(entries) || entries.length < 2) throw new Error('الحركة تحتاج طرفين محاسبيين على الأقل');
    const balances = balanceByCurrency(entries);
    for (const [currency, balance] of Object.entries(balances)) {
      if (Math.abs(balance.difference) > EPSILON) throw new Error(`الحركة غير متزنة بعملة ${currency}`);
    }
    return true;
  }

  function createJournal(input) {
    const entries = (input.entries || []).map(entry => makeEntry(
      entry.account_id,
      entry.currency || input.currency,
      entry.debit,
      entry.credit,
      entry.memo || ''
    ));
    assertBalanced(entries);
    const createdAt = input.created_at || new Date().toISOString();
    return {
      id: input.id || uid('txn'),
      journal_version: 1,
      date: input.date || createdAt.slice(0, 10),
      created_at: createdAt,
      updated_at: input.updated_at || createdAt,
      kind: input.kind || 'journal',
      description: input.description || '',
      scope: input.scope || 'work',
      category_id: input.category_id || '',
      reference_type: input.reference_type || '',
      reference_id: input.reference_id || '',
      amount: round(input.amount || 0),
      currency: input.currency || entries[0].currency,
      entries,
      source: input.source || 'app',
      voided_at: input.voided_at || '',
      reversal_id: input.reversal_id || '',
      meta: input.meta || {}
    };
  }

  function incomeJournal(input) {
    const amount = positiveAmount(input.amount);
    return createJournal({
      ...input,
      kind: input.kind || 'income',
      amount,
      entries: [
        makeEntry(input.account_id, input.currency, amount, 0),
        makeEntry(SYSTEM.income, input.currency, 0, amount)
      ]
    });
  }

  function expenseJournal(input) {
    const amount = positiveAmount(input.amount);
    return createJournal({
      ...input,
      kind: input.kind || 'expense',
      amount,
      entries: [
        makeEntry(input.expense_account_id || SYSTEM.expense, input.currency, amount, 0),
        makeEntry(input.account_id, input.currency, 0, amount)
      ]
    });
  }

  function transferJournal(input) {
    const amount = positiveAmount(input.amount);
    if (input.from_account_id === input.to_account_id) throw new Error('اختر حسابين مختلفين');
    return createJournal({
      ...input,
      kind: 'transfer',
      amount,
      entries: [
        makeEntry(input.to_account_id, input.currency, amount, 0),
        makeEntry(input.from_account_id, input.currency, 0, amount)
      ]
    });
  }

  function fxTransferJournal(input) {
    const fromAmount = positiveAmount(input.from_amount, 'المبلغ المرسل');
    const toAmount = positiveAmount(input.to_amount, 'المبلغ المستلم');
    if (input.from_currency === input.to_currency) {
      return transferJournal({ ...input, amount: fromAmount, currency: input.from_currency });
    }
    return createJournal({
      ...input,
      kind: 'fx_transfer',
      amount: fromAmount,
      currency: input.from_currency,
      meta: { ...(input.meta || {}), from_amount: fromAmount, to_amount: toAmount, to_currency: input.to_currency },
      entries: [
        makeEntry(SYSTEM.fx, input.from_currency, fromAmount, 0),
        makeEntry(input.from_account_id, input.from_currency, 0, fromAmount),
        makeEntry(input.to_account_id, input.to_currency, toAmount, 0),
        makeEntry(SYSTEM.fx, input.to_currency, 0, toAmount)
      ]
    });
  }

  function openingBalanceJournal(input) {
    const raw = round(input.amount);
    if (raw === 0) return null;
    const amount = Math.abs(raw);
    const entries = raw > 0
      ? [makeEntry(input.account_id, input.currency, amount, 0), makeEntry(SYSTEM.equity, input.currency, 0, amount)]
      : [makeEntry(SYSTEM.equity, input.currency, amount, 0), makeEntry(input.account_id, input.currency, 0, amount)];
    return createJournal({
      ...input,
      kind: 'opening_balance',
      amount,
      description: input.description || 'رصيد افتتاحي',
      entries
    });
  }

  function orderCostJournal(input) {
    const amount = positiveAmount(input.amount);
    return createJournal({
      ...input,
      kind: 'order_cost',
      amount,
      reference_type: 'order_cost',
      entries: input.paid
        ? [makeEntry(SYSTEM.cogs, input.currency, amount, 0), makeEntry(input.account_id, input.currency, 0, amount)]
        : [makeEntry(SYSTEM.cogs, input.currency, amount, 0), makeEntry(SYSTEM.payable, input.currency, 0, amount)]
    });
  }

  function costSettlementJournal(input) {
    const amount = positiveAmount(input.amount);
    return createJournal({
      ...input,
      kind: 'cost_settlement',
      amount,
      reference_type: 'order_cost',
      entries: [
        makeEntry(SYSTEM.payable, input.currency, amount, 0),
        makeEntry(input.account_id, input.currency, 0, amount)
      ]
    });
  }

  function debtOpeningJournal(input) {
    const amount = positiveAmount(input.amount);
    const entries = input.kind === 'receivable'
      ? [makeEntry(SYSTEM.receivable, input.currency, amount, 0), makeEntry(SYSTEM.equity, input.currency, 0, amount)]
      : [makeEntry(SYSTEM.equity, input.currency, amount, 0), makeEntry(SYSTEM.payable, input.currency, 0, amount)];
    return createJournal({
      ...input,
      kind: 'debt_opening',
      amount,
      reference_type: 'debt',
      entries
    });
  }

  function debtSettlementJournal(input) {
    const amount = positiveAmount(input.amount);
    const entries = input.kind === 'receivable'
      ? [makeEntry(input.account_id, input.currency, amount, 0), makeEntry(SYSTEM.receivable, input.currency, 0, amount)]
      : [makeEntry(SYSTEM.payable, input.currency, amount, 0), makeEntry(input.account_id, input.currency, 0, amount)];
    return createJournal({
      ...input,
      kind: 'debt_settlement',
      amount,
      reference_type: 'debt',
      entries
    });
  }

  function reverseJournal(journal, createdAt = new Date().toISOString()) {
    if (!journal || journal.voided_at) throw new Error('لا يمكن عكس هذه الحركة');
    return createJournal({
      id: uid('reversal'),
      date: createdAt.slice(0, 10),
      created_at: createdAt,
      kind: 'reversal',
      description: `عكس: ${journal.description || journal.kind}`,
      scope: journal.scope,
      category_id: journal.category_id,
      reference_type: 'transaction',
      reference_id: journal.id,
      amount: journal.amount,
      currency: journal.currency,
      entries: journal.entries.map(entry => makeEntry(entry.account_id, entry.currency, entry.credit, entry.debit)),
      meta: { reverses: journal.id }
    });
  }

  function accountBalance(accountId, journals) {
    return round((journals || []).reduce((balance, journal) => balance + (journal.entries || [])
      .filter(entry => entry.account_id === accountId)
      .reduce((entryBalance, entry) => entryBalance + toNumber(entry.debit) - toNumber(entry.credit), 0), 0));
  }

  function journalFlow(journal) {
    const entries = journal.entries || [];
    const income = sum(entries.filter(entry => entry.account_id === SYSTEM.income), entry => entry.credit - entry.debit);
    const expense = sum(entries.filter(entry => [SYSTEM.expense, SYSTEM.cogs].includes(entry.account_id)), entry => entry.debit - entry.credit);
    return { income, expense, profit: round(income - expense), currency: journal.currency };
  }

  function orderMetrics(order, payments, costs) {
    const total = round(order?.amount || 0);
    const paid = sum((payments || []).filter(item => item.order_id === order?.id), item => item.amount);
    const totalCosts = sum((costs || []).filter(item => item.order_id === order?.id), item => item.amount);
    const paidCosts = sum((costs || []).filter(item => item.order_id === order?.id), item => Math.min(toNumber(item.amount), toNumber(item.paid_amount)));
    return {
      total,
      paid,
      due: Math.max(0, round(total - paid)),
      total_costs: totalCosts,
      unpaid_costs: Math.max(0, round(totalCosts - paidCosts)),
      expected_profit: round(total - totalCosts),
      cash_profit: round(paid - paidCosts)
    };
  }

  function debtBalance(debt, settlements) {
    if (debt?.legacy_settled || debt?.status === 'legacy_settled') return 0;
    const settled = sum((settlements || []).filter(item => item.debt_id === debt?.id), item => item.amount);
    return Math.max(0, round(toNumber(debt?.amount) - settled));
  }

  function latestRates(rates, date) {
    const cutoff = date || '9999-12-31';
    const map = new Map();
    (rates || []).filter(rate => rate.date <= cutoff && toNumber(rate.rate) > 0).forEach(rate => {
      const key = `${rate.from_currency}:${rate.to_currency}`;
      const current = map.get(key);
      if (!current || current.date < rate.date || (current.date === rate.date && current.created_at < rate.created_at)) map.set(key, rate);
    });
    return [...map.values()];
  }

  function exchangeRate(from, to, date, rates) {
    if (from === to) return 1;
    const graph = {};
    for (const rate of latestRates(rates, date)) {
      const value = toNumber(rate.rate);
      (graph[rate.from_currency] ||= []).push([rate.to_currency, value]);
      (graph[rate.to_currency] ||= []).push([rate.from_currency, 1 / value]);
    }
    const queue = [[from, 1]];
    const visited = new Set([from]);
    while (queue.length) {
      const [currency, value] = queue.shift();
      for (const [next, edge] of graph[currency] || []) {
        if (next === to) return value * edge;
        if (!visited.has(next)) {
          visited.add(next);
          queue.push([next, value * edge]);
        }
      }
    }
    return null;
  }

  function convertAmount(amount, from, to, date, rates) {
    const rate = exchangeRate(from, to, date, rates);
    return rate === null ? null : round(toNumber(amount) * rate);
  }

  function periodBounds(mode, anchor) {
    const date = new Date(`${anchor || today()}T12:00:00`);
    if (Number.isNaN(date.getTime())) throw new Error('تاريخ غير صالح');
    const y = date.getFullYear();
    const m = date.getMonth();
    const format = value => {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    if (mode === 'day') return { from: format(date), to: format(date) };
    if (mode === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` };
    return { from: format(new Date(y, m, 1)), to: format(new Date(y, m + 1, 0)) };
  }

  function inPeriod(item, bounds) {
    const date = (item.date || item.created_at || '').slice(0, 10);
    return date >= bounds.from && date <= bounds.to;
  }

  function reportTotals(journals, rates, targetCurrency, bounds, scope = 'all') {
    const result = { income: 0, expense: 0, profit: 0, missing_rates: [] };
    for (const journal of (journals || []).filter(item => inPeriod(item, bounds) && (scope === 'all' || item.scope === scope))) {
      const flow = journalFlow(journal);
      if (flow.income === 0 && flow.expense === 0) continue;
      const rate = exchangeRate(journal.currency, targetCurrency, journal.date, rates);
      if (rate === null) {
        result.missing_rates.push({ from: journal.currency, to: targetCurrency, date: journal.date, transaction_id: journal.id });
        continue;
      }
      result.income = round(result.income + flow.income * rate);
      result.expense = round(result.expense + flow.expense * rate);
    }
    result.profit = round(result.income - result.expense);
    return result;
  }

  function migrateLegacyTransaction(transaction) {
    if (!transaction || transaction.journal_version === 1) return transaction;
    if (!['income', 'expense'].includes(transaction.type)) return transaction;
    const currency = transaction.currency || 'TRY';
    const accountId = transaction.account || 'cash';
    const amount = positiveAmount(transaction.amount);
    const base = {
      ...transaction,
      date: transaction.date || (transaction.created_at || new Date().toISOString()).slice(0, 10),
      kind: `legacy_${transaction.type}`,
      description: transaction.note || (transaction.type === 'income' ? 'إيراد مرحّل' : 'مصروف مرحّل'),
      account_id: accountId,
      source: 'migration-v0.2',
      meta: { ...(transaction.meta || {}), legacy_type: transaction.type }
    };
    return transaction.type === 'income' ? incomeJournal(base) : expenseJournal(base);
  }

  function migrateLegacyTransfer(transfer) {
    return transferJournal({
      id: `migration:transfer:${transfer.id}`,
      date: transfer.date || (transfer.created_at || new Date().toISOString()).slice(0, 10),
      created_at: transfer.created_at,
      from_account_id: transfer.from,
      to_account_id: transfer.to,
      amount: transfer.amount,
      currency: transfer.currency || 'TRY',
      description: transfer.note || 'تحويل مرحّل',
      scope: transfer.scope || 'work',
      source: 'migration-v0.2',
      meta: { legacy_transfer_id: transfer.id }
    });
  }

  function validateSnapshot(snapshot, knownStores = []) {
    if (!snapshot || typeof snapshot !== 'object') throw new Error('ملف النسخة الاحتياطية غير صالح');
    if (!snapshot.data && !knownStores.some(store => Array.isArray(snapshot[store]))) throw new Error('لا توجد بيانات قابلة للاستعادة');
    const data = snapshot.data || snapshot;
    for (const store of knownStores) {
      if (data[store] !== undefined && !Array.isArray(data[store])) throw new Error(`الجدول ${store} غير صالح`);
    }
    for (const transaction of data.transactions || []) {
      if (transaction.journal_version === 1) assertBalanced(transaction.entries);
    }
    return { data, source_version: snapshot.app_version || snapshot.version || 'legacy' };
  }

  function integrityReport(data) {
    const issues = [];
    for (const transaction of data.transactions || []) {
      try { if (transaction.journal_version === 1) assertBalanced(transaction.entries); }
      catch (error) { issues.push({ type: 'unbalanced_transaction', id: transaction.id, message: error.message }); }
    }
    const ids = new Set();
    for (const store of ['customers', 'orders', 'transactions', 'payments', 'debts', 'debt_settlements', 'order_costs']) {
      for (const record of data[store] || []) {
        const key = `${store}:${record.id}`;
        if (!record.id) issues.push({ type: 'missing_id', store });
        else if (ids.has(key)) issues.push({ type: 'duplicate_id', store, id: record.id });
        ids.add(key);
      }
    }
    const customerIds = new Set((data.customers || []).map(item => item.id));
    for (const order of data.orders || []) {
      if (order.customer_id && !customerIds.has(order.customer_id)) issues.push({ type: 'missing_customer', order_id: order.id });
    }
    return { ok: issues.length === 0, issues };
  }

  return {
    APP_VERSION, DB_VERSION, CURRENCIES, SYSTEM, EPSILON,
    round, toNumber, sum, today, uid, positiveAmount, makeEntry,
    balanceByCurrency, assertBalanced, createJournal, incomeJournal,
    expenseJournal, transferJournal, fxTransferJournal, openingBalanceJournal,
    orderCostJournal, costSettlementJournal, debtOpeningJournal,
    debtSettlementJournal, reverseJournal, accountBalance, journalFlow,
    orderMetrics, debtBalance, exchangeRate, convertAmount, periodBounds,
    inPeriod, reportTotals, migrateLegacyTransaction, migrateLegacyTransfer,
    validateSnapshot, integrityReport
  };
});
