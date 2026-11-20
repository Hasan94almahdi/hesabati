const test = require('node:test');
const assert = require('node:assert/strict');
require('fake-indexeddb/auto');

const Core = require('../core.js');
global.window = global;
global.HesabatiCore = Core;
require('../db.js');
const DB = global.HesabatiDB;

test('real IndexedDB export and replace-restore preserves a balanced dataset', async () => {
  const opened = await DB.open();
  assert.equal(opened.migration.migrated, false);

  const customer = { id: 'customer:backup', name: 'Backup Customer', created_at: '2026-11-21T00:00:00Z' };
  const journal = Core.incomeJournal({
    id: 'txn:backup', amount: 345, account_id: 'cash', currency: 'TRY',
    date: '2026-11-21', description: 'Backup income'
  });
  await DB.commit(
    { customers: [customer], transactions: [journal] },
    { action: 'create', entity_type: 'test', entity_id: 'backup', details: {} }
  );

  const backup = await DB.exportBackup();
  assert.equal(backup.format, 'hesabati-backup');
  assert.equal(backup.integrity.ok, true);
  assert.ok(backup.data.customers.some(item => item.id === customer.id));

  await DB.put('customers', { id: 'customer:temporary', name: 'Temporary' });
  assert.ok(await DB.get('customers', 'customer:temporary'));

  const restored = await DB.restoreBackup(backup);
  assert.equal(restored.source_version, Core.APP_VERSION);
  assert.equal(await DB.get('customers', 'customer:temporary'), undefined);
  assert.equal((await DB.get('customers', customer.id)).name, 'Backup Customer');
  const restoredJournal = await DB.get('transactions', journal.id);
  assert.equal(Core.assertBalanced(restoredJournal.entries), true);
  assert.equal(Core.accountBalance('cash', [restoredJournal]), 345);
  assert.ok((await DB.internalBackups()).some(item => item.id.startsWith('pre-restore:')));
});

test('restoring a legacy 0.2 backup performs migration without losing old records', async () => {
  const legacy = {
    version: 2,
    exported_at: '2025-01-10T00:00:00Z',
    customers: [{ id: 'legacy-customer', name: 'Legacy Customer', phone: '123' }],
    orders: [{ id: 'legacy-order', customer_id: 'legacy-customer', title: 'Legacy Order', amount: 900, currency: 'TRY', created_at: '2025-01-02T00:00:00Z' }],
    accounts: [{ id: 'legacy-usd', name: 'Legacy USD', currency: 'USD', opening: 25, scope: 'work', created_at: '2025-01-01T00:00:00Z' }],
    transactions: [{ id: 'legacy-income', type: 'income', amount: 100, currency: 'TRY', account: 'cash', scope: 'work', note: 'Old sale', created_at: '2025-01-03T00:00:00Z' }],
    transfers: [{ id: 'legacy-transfer', from: 'cash', to: 'bank', amount: 20, currency: 'TRY', created_at: '2025-01-04T00:00:00Z' }],
    payments: [], followups: [], debts: [], tasks: [], settings: []
  };

  await DB.restoreBackup(legacy);

  assert.equal((await DB.get('customers', 'legacy-customer')).name, 'Legacy Customer');
  assert.equal((await DB.get('orders', 'legacy-order')).amount, 900);
  const income = await DB.get('transactions', 'legacy-income');
  assert.equal(income.kind, 'legacy_income');
  assert.equal(Core.assertBalanced(income.entries), true);
  assert.equal(Core.accountBalance('cash', [income]), 100);

  const transfer = await DB.get('transactions', 'migration:transfer:legacy-transfer');
  assert.equal(transfer.kind, 'transfer');
  assert.equal(Core.assertBalanced(transfer.entries), true);

  const opening = await DB.get('transactions', 'migration:opening:legacy-usd');
  assert.equal(opening.kind, 'opening_balance');
  assert.equal(Core.accountBalance('legacy-usd', [opening]), 25);
  assert.equal((await DB.get('accounts', 'legacy-usd')).opening, 0);
});
