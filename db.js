(function (root) {
  'use strict';

  const Core = root.HesabatiCore;
  if (!Core) throw new Error('HesabatiCore is required before db.js');

  const DB_NAME = 'hesabati-v1';
  const STORES = [
    'customers', 'orders', 'followups', 'transactions', 'accounts', 'settings',
    'payments', 'transfers', 'debts', 'tasks', 'categories', 'budgets',
    'exchange_rates', 'order_costs', 'debt_settlements', 'audit_log',
    'migration_backups'
  ];
  const EXPORT_STORES = STORES.filter(name => name !== 'migration_backups');
  const LEGACY_STORES = ['customers', 'orders', 'followups', 'transactions', 'accounts', 'settings', 'payments', 'transfers', 'debts', 'tasks'];

  const DEFAULT_ACCOUNTS = [
    { id: 'cash', name: 'نقدي', currency: 'TRY', scope: 'work', account_type: 'asset', hidden: false, system: true },
    { id: 'bank', name: 'بنك', currency: 'TRY', scope: 'work', account_type: 'asset', hidden: false, system: true },
    { id: Core.SYSTEM.income, name: 'الإيرادات', currency: 'MULTI', account_type: 'income', hidden: true, system: true },
    { id: Core.SYSTEM.expense, name: 'المصاريف', currency: 'MULTI', account_type: 'expense', hidden: true, system: true },
    { id: Core.SYSTEM.cogs, name: 'تكاليف الطلبات', currency: 'MULTI', account_type: 'expense', hidden: true, system: true },
    { id: Core.SYSTEM.equity, name: 'الرصيد الافتتاحي والتسويات', currency: 'MULTI', account_type: 'equity', hidden: true, system: true },
    { id: Core.SYSTEM.receivable, name: 'ذمم مدينة', currency: 'MULTI', account_type: 'asset', hidden: true, system: true },
    { id: Core.SYSTEM.payable, name: 'ذمم دائنة', currency: 'MULTI', account_type: 'liability', hidden: true, system: true },
    { id: Core.SYSTEM.fx, name: 'وسيط تحويل العملات', currency: 'MULTI', account_type: 'clearing', hidden: true, system: true }
  ];

  const DEFAULT_CATEGORIES = [
    ['cat:sales', 'مبيعات', 'income', 'work'],
    ['cat:services', 'خدمات', 'income', 'work'],
    ['cat:supplies', 'مواد ومستلزمات', 'expense', 'work'],
    ['cat:delivery', 'شحن وتوصيل', 'expense', 'work'],
    ['cat:marketing', 'تسويق', 'expense', 'work'],
    ['cat:home', 'مصاريف البيت', 'expense', 'home'],
    ['cat:personal', 'مصاريف شخصية', 'expense', 'personal']
  ].map(([id, name, type, scope]) => ({ id, name, type, scope, system: true }));

  let database = null;

  function requestPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transactionPromise(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('فشلت عملية التخزين'));
      transaction.onabort = () => reject(transaction.error || new Error('أُلغيت عملية التخزين'));
    });
  }

  function openRaw() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, Core.DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of STORES) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('أغلق النسخة القديمة من التطبيق ثم أعد المحاولة'));
    });
  }

  async function all(store) {
    if (!database) throw new Error('قاعدة البيانات غير مفتوحة');
    return requestPromise(database.transaction(store, 'readonly').objectStore(store).getAll());
  }

  async function get(store, id) {
    if (!database) throw new Error('قاعدة البيانات غير مفتوحة');
    return requestPromise(database.transaction(store, 'readonly').objectStore(store).get(id));
  }

  async function put(store, record) {
    if (!database) throw new Error('قاعدة البيانات غير مفتوحة');
    const transaction = database.transaction(store, 'readwrite');
    const done = transactionPromise(transaction);
    transaction.objectStore(store).put(record);
    await done;
    return record;
  }

  async function remove(store, id) {
    const transaction = database.transaction(store, 'readwrite');
    const done = transactionPromise(transaction);
    transaction.objectStore(store).delete(id);
    await done;
  }

  async function batchPut(recordsByStore) {
    const names = Object.keys(recordsByStore).filter(name => STORES.includes(name) && (recordsByStore[name] || []).length);
    if (!names.length) return;
    const transaction = database.transaction(names, 'readwrite');
    const done = transactionPromise(transaction);
    for (const name of names) {
      const store = transaction.objectStore(name);
      for (const record of recordsByStore[name]) store.put(record);
    }
    await done;
  }

  async function snapshot(storeNames = EXPORT_STORES) {
    const names = storeNames.filter(name => STORES.includes(name));
    const data = {};
    await Promise.all(names.map(async name => { data[name] = await all(name); }));
    return data;
  }

  function normalizeLegacyData(data) {
    const now = new Date().toISOString();
    const accountMap = new Map((data.accounts || []).map(account => [account.id, { ...account }]));
    for (const account of DEFAULT_ACCOUNTS) {
      if (!accountMap.has(account.id)) accountMap.set(account.id, { ...account, created_at: now });
    }

    const journals = new Map();
    for (const transaction of data.transactions || []) {
      try {
        const migrated = Core.migrateLegacyTransaction(transaction);
        journals.set(migrated.id, migrated);
      } catch (error) {
        journals.set(transaction.id, { ...transaction, migration_error: error.message });
      }
    }
    for (const transfer of data.transfers || []) {
      const id = `migration:transfer:${transfer.id}`;
      if (!journals.has(id)) {
        try { journals.set(id, Core.migrateLegacyTransfer(transfer)); }
        catch (error) { /* Keep the untouched transfer in its legacy table for manual review. */ }
      }
    }

    for (const account of accountMap.values()) {
      const opening = Core.round(account.opening || 0);
      const journalId = `migration:opening:${account.id}`;
      if (opening !== 0 && !journals.has(journalId)) {
        const openingJournal = Core.openingBalanceJournal({
          id: journalId,
          account_id: account.id,
          amount: opening,
          currency: account.currency || 'TRY',
          date: (account.created_at || now).slice(0, 10),
          created_at: account.created_at || now,
          scope: account.scope || 'work',
          source: 'migration-v0.2',
          description: `رصيد افتتاحي مرحّل: ${account.name || account.id}`
        });
        if (openingJournal) journals.set(journalId, openingJournal);
        account.legacy_opening = opening;
        account.opening = 0;
        account.opening_migrated = true;
      }
      account.account_type ||= 'asset';
      account.hidden = Boolean(account.hidden);
      account.currency ||= 'TRY';
    }

    const categoryMap = new Map((data.categories || []).map(category => [category.id, category]));
    for (const category of DEFAULT_CATEGORIES) if (!categoryMap.has(category.id)) categoryMap.set(category.id, category);

    const orders = (data.orders || []).map(order => ({
      status: 'new', currency: 'TRY', amount: 0, scope: 'work', ...order,
      amount: Core.round(order.amount || 0),
      accounting_status: order.accounting_status || (order.created_at ? 'cash_basis' : 'legacy_unposted')
    }));
    const debts = (data.debts || []).map(debt => ({
      currency: 'TRY', kind: 'receivable', ...debt,
      amount: Core.round(debt.amount || 0),
      legacy_settled: Boolean(debt.settled),
      status: debt.settled ? 'legacy_settled' : (debt.status || 'open')
    }));
    const payments = (data.payments || []).map(payment => ({
      ...payment,
      account_id: payment.account_id || payment.account || 'cash',
      currency: payment.currency || 'TRY',
      amount: Core.round(payment.amount || 0),
      date: payment.date || (payment.created_at || now).slice(0, 10)
    }));

    return {
      accounts: [...accountMap.values()],
      transactions: [...journals.values()],
      categories: [...categoryMap.values()],
      orders,
      debts,
      payments
    };
  }

  async function migrate() {
    const current = await snapshot(STORES.filter(name => name !== 'migration_backups'));
    const hasMarker = (current.settings || []).some(item => item.id === 'migration:v1.0');
    const hasUserData = LEGACY_STORES.filter(name => name !== 'settings').some(name => (current[name] || []).length > 0);
    const hasLegacyRecords = (current.transactions || []).some(item => item.type && item.journal_version !== 1)
      || (current.transfers || []).some(item => !(current.transactions || []).some(tx => tx.id === `migration:transfer:${item.id}`))
      || (current.accounts || []).some(item => Core.round(item.opening || 0) !== 0);
    const needsSchemaSetup = !hasMarker;
    const needsLegacyMigration = hasLegacyRecords || (needsSchemaSetup && hasUserData);

    if (needsLegacyMigration) {
      const internalBackup = {
        id: `pre-v1.0:${new Date().toISOString()}`,
        created_at: new Date().toISOString(),
        from_db_version: 2,
        to_db_version: Core.DB_VERSION,
        data: Object.fromEntries(LEGACY_STORES.map(name => [name, current[name] || []]))
      };
      await put('migration_backups', internalBackup);
    }

    const normalized = normalizeLegacyData(current);
    const migrationRecord = {
      id: 'migration:v1.0',
      schema_version: Core.DB_VERSION,
      app_version: Core.APP_VERSION,
      completed_at: new Date().toISOString(),
      source: needsLegacyMigration ? 'v0.2-or-backup' : (needsSchemaSetup ? 'fresh' : 'current')
    };
    await batchPut({ ...normalized, settings: [migrationRecord] });
    return { migrated: needsLegacyMigration, backup_created: needsLegacyMigration };
  }

  async function open() {
    if (database) return { db: database, migration: { migrated: false } };
    database = await openRaw();
    database.onversionchange = () => database.close();
    const migration = await migrate();
    return { db: database, migration };
  }

  async function audit(action, entityType, entityId, details = {}) {
    return put('audit_log', {
      id: Core.uid('audit'),
      action,
      entity_type: entityType,
      entity_id: entityId,
      details,
      created_at: new Date().toISOString()
    });
  }

  async function commit(recordsByStore, auditEntry) {
    const payload = { ...recordsByStore };
    if (auditEntry) {
      payload.audit_log = [...(payload.audit_log || []), {
        id: Core.uid('audit'),
        created_at: new Date().toISOString(),
        ...auditEntry
      }];
    }
    await batchPut(payload);
  }

  async function getPreference() {
    return (await get('settings', 'preferences')) || {
      id: 'preferences', base_currency: 'TRY', default_scope: 'work', theme: 'light'
    };
  }

  async function setPreference(patch) {
    const value = { ...(await getPreference()), ...patch, updated_at: new Date().toISOString() };
    await put('settings', value);
    return value;
  }

  async function exportBackup() {
    const data = await snapshot(EXPORT_STORES);
    return {
      format: 'hesabati-backup',
      schema_version: Core.DB_VERSION,
      app_version: Core.APP_VERSION,
      exported_at: new Date().toISOString(),
      data,
      integrity: Core.integrityReport(data)
    };
  }

  async function restoreBackup(input) {
    const checked = Core.validateSnapshot(input, EXPORT_STORES);
    const current = await exportBackup();
    await put('migration_backups', {
      id: `pre-restore:${new Date().toISOString()}`,
      created_at: new Date().toISOString(),
      from_db_version: Core.DB_VERSION,
      to_db_version: Core.DB_VERSION,
      data: current.data
    });

    const transaction = database.transaction(EXPORT_STORES, 'readwrite');
    const done = transactionPromise(transaction);
    for (const name of EXPORT_STORES) {
      const store = transaction.objectStore(name);
      store.clear();
      for (const record of checked.data[name] || []) store.put(record);
    }
    await done;
    const migration = await migrate();
    await audit('restore', 'backup', '', { source_version: checked.source_version });
    return { migration, source_version: checked.source_version };
  }

  async function internalBackups() {
    return all('migration_backups');
  }

  root.HesabatiDB = {
    DB_NAME, STORES, EXPORT_STORES, DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES,
    open, all, get, put, remove, batchPut, commit, snapshot, audit,
    getPreference, setPreference, exportBackup, restoreBackup, internalBackups,
    normalizeLegacyData
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
