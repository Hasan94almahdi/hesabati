(function () {
  'use strict';

  const Core = window.HesabatiCore;
  const DB = window.HesabatiDB;
  const app = document.getElementById('app');
  const toastNode = document.getElementById('toast');
  const restoreInput = document.getElementById('restore-file');

  const state = {
    data: {},
    preference: { base_currency: 'TRY', default_scope: 'work' },
    migration: null,
    backupCount: 0,
    journalFilter: 'all',
    crmTab: 'customers',
    reportMode: 'month',
    reportAnchor: Core.today(),
    reportScope: 'all',
    integrity: null,
    installPrompt: null
  };

  const labels = {
    work: 'العمل', personal: 'شخصي', home: 'البيت', all: 'الكل',
    new: 'جديد', progress: 'قيد التنفيذ', waiting: 'بانتظار العميل',
    done: 'مكتمل', cancelled: 'ملغي', receivable: 'لنا عند الغير',
    payable: 'علينا للغير', income: 'إيراد', expense: 'مصروف',
    transfer: 'تحويل', fx_transfer: 'تحويل عملة', order_payment: 'دفعة طلب',
    order_cost: 'تكلفة طلب', cost_settlement: 'تسديد تكلفة',
    debt_opening: 'فتح مستحق', debt_settlement: 'تسوية مستحق',
    opening_balance: 'رصيد افتتاحي', reversal: 'حركة عكسية',
    legacy_income: 'إيراد مرحّل', legacy_expense: 'مصروف مرحّل'
  };

  const navItems = [
    ['home', '⌂', 'الرئيسية'],
    ['journal', '≡', 'الحركات'],
    ['clients', '♙', 'العملاء'],
    ['reports', '▥', 'التقارير'],
    ['more', '•••', 'المزيد']
  ];

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const attr = esc;
  const byId = (store, id) => (state.data[store] || []).find(item => item.id === id);
  const sorted = (items, field = 'created_at') => (items || []).slice().sort((a, b) => String(b[field] || '').localeCompare(String(a[field] || '')));
  const accounts = () => (state.data.accounts || []).filter(account => !account.hidden);
  const accountName = id => byId('accounts', id)?.name || id || '—';
  const categoryName = id => byId('categories', id)?.name || 'بدون تصنيف';
  const customerName = id => byId('customers', id)?.name || 'بدون عميل';

  function money(value, currency) {
    return new Intl.NumberFormat('ar', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Core.round(value)) + ' ' + esc(currency || state.preference.base_currency);
  }

  function dateLabel(value, withTime) {
    if (!value) return 'بدون موعد';
    const date = new Date(value.length === 10 ? value + 'T12:00:00' : value);
    if (Number.isNaN(date.getTime())) return esc(value);
    return new Intl.DateTimeFormat('ar', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(date);
  }

  function routeInfo() {
    const raw = (location.hash || '#home').slice(1);
    const parts = raw.split('?');
    return { path: parts[0] || 'home', query: new URLSearchParams(parts[1] || '') };
  }

  function route(path) {
    location.hash = path;
  }

  function optionList(items, selected) {
    return items.map(item => {
      const value = Array.isArray(item) ? item[0] : item.id;
      const label = Array.isArray(item) ? item[1] : item.name;
      return '<option value="' + attr(value) + '"' + (String(value) === String(selected) ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
  }

  function currencyOptions(selected) {
    return optionList(Core.CURRENCIES.map(code => [code, code]), selected || 'TRY');
  }

  function accountOptions(selected, currency) {
    const items = accounts().filter(account => !currency || account.currency === currency);
    if (!items.length) return '<option value="">أنشئ حساباً بهذه العملة أولاً</option>';
    return items.map(account => '<option value="' + attr(account.id) + '"' + (account.id === selected ? ' selected' : '') + '>' + esc(account.name) + ' · ' + esc(account.currency) + '</option>').join('');
  }

  function categoryOptions(type, selected) {
    const items = (state.data.categories || []).filter(category => !type || category.type === type);
    return '<option value="">بدون تصنيف</option>' + optionList(items, selected);
  }

  function currentMain(path) {
    if (['home'].includes(path)) return 'home';
    if (path === 'journal' || path.startsWith('transaction/')) return 'journal';
    if (['clients', 'orders'].includes(path) || path.startsWith('customer/') || path.startsWith('order/')) return 'clients';
    if (path === 'reports') return 'reports';
    if (path.startsWith('form/')) {
      const type = path.split('/')[1];
      if (['customer', 'order', 'payment', 'cost', 'cost-settlement'].includes(type)) return 'clients';
      if (['income', 'expense', 'transfer'].includes(type)) return 'journal';
    }
    return 'more';
  }

  function navigation(path) {
    const active = currentMain(path);
    return '<nav class="bottom-nav" aria-label="التنقل الرئيسي"><div class="bottom-nav-inner">' +
      navItems.map(item => '<button class="nav-button ' + (active === item[0] ? 'active' : '') + '" data-route="' + item[0] + '"><span class="nav-icon">' + item[1] + '</span><span>' + item[2] + '</span></button>').join('') +
      '</div></nav>';
  }

  function layout(content, path) {
    return '<main class="page-wrap">' + content + '</main>' + navigation(path);
  }

  function appHeader(title, kicker) {
    return '<header class="app-header"><div><div class="brand-kicker">' + esc(kicker || 'دفترك المالي المحلي') + '</div><h1>' + esc(title) + '</h1></div><div class="header-badge">' + (navigator.onLine ? 'محفوظ محلياً' : 'يعمل دون إنترنت') + '</div></header>';
  }

  function pageHeader(title, subtitle, back) {
    return '<header class="page-header"><button class="back-button" data-action="back" data-fallback="' + attr(back || 'more') + '" aria-label="رجوع">←</button><div><h1>' + esc(title) + '</h1>' + (subtitle ? '<p>' + esc(subtitle) + '</p>' : '') + '</div></header>';
  }

  function empty(title, text) {
    return '<div class="empty"><strong>' + esc(title) + '</strong><p>' + esc(text) + '</p></div>';
  }

  function pill(text, tone) {
    return '<span class="pill ' + (tone || '') + '">' + esc(text) + '</span>';
  }

  function sectionHead(title, actionText, actionRoute) {
    return '<div class="section-head"><h2>' + esc(title) + '</h2>' + (actionRoute ? '<button data-route="' + attr(actionRoute) + '">' + esc(actionText) + '</button>' : '') + '</div>';
  }

  function convertedSum(rows, valueGetter, currencyGetter, dateGetter, target) {
    let total = 0;
    let missing = 0;
    for (const row of rows) {
      const value = Core.convertAmount(valueGetter(row), currencyGetter(row), target, dateGetter(row), state.data.exchange_rates || []);
      if (value == null) missing += 1;
      else total = Core.round(total + value);
    }
    return { total, missing };
  }

  function transactionRow(transaction) {
    const flow = Core.journalFlow(transaction);
    const isIncome = flow.income > 0;
    const isExpense = flow.expense > 0;
    const value = isIncome ? flow.income : (isExpense ? flow.expense : transaction.amount);
    const tone = isIncome ? 'income' : (isExpense ? 'expense' : '');
    const sign = isIncome ? '+' : (isExpense ? '−' : '');
    const icon = isIncome ? '+' : (isExpense ? '−' : '↔');
    return '<button class="list-row" data-route="transaction/' + attr(transaction.id) + '">' +
      '<span class="row-icon">' + icon + '</span><span class="list-main"><span class="list-title">' + esc(transaction.description || labels[transaction.kind] || 'حركة مالية') + '</span>' +
      '<span class="list-subtitle">' + dateLabel(transaction.date) + ' · ' + esc(labels[transaction.scope] || transaction.scope || 'العمل') + ' · ' + esc(categoryName(transaction.category_id)) + '</span></span>' +
      '<span class="list-side"><span class="list-amount ' + tone + '">' + sign + ' ' + money(value, transaction.currency) + '</span>' + (transaction.voided_at ? pill('معكوسة', 'red') : '') + '</span></button>';
  }

  function scopeSegments(active, action) {
    return '<div class="segmented">' + [['all', 'الكل'], ['work', 'العمل'], ['personal', 'شخصي'], ['home', 'البيت']]
      .map(item => '<button class="' + (active === item[0] ? 'active' : '') + '" data-action="' + action + '" data-value="' + item[0] + '">' + item[1] + '</button>').join('') + '</div>';
  }

  function homeView() {
    const base = state.preference.base_currency || 'TRY';
    const bounds = Core.periodBounds('month', Core.today());
    const totals = Core.reportTotals(state.data.transactions || [], state.data.exchange_rates || [], base, bounds, 'all');
    const openOrders = (state.data.orders || []).filter(order => !['done', 'cancelled'].includes(order.status));
    const dueRows = openOrders.map(order => ({ order, amount: Core.orderMetrics(order, state.data.payments, state.data.order_costs).due })).filter(item => item.amount > 0);
    const receivable = convertedSum(dueRows, item => item.amount, item => item.order.currency, item => item.order.due || Core.today(), base);
    const openDebts = (state.data.debts || []).map(debt => ({ debt, amount: Core.debtBalance(debt, state.data.debt_settlements) })).filter(item => item.amount > 0);
    const debtReceivable = convertedSum(openDebts.filter(item => item.debt.kind === 'receivable'), item => item.amount, item => item.debt.currency, item => item.debt.due || Core.today(), base);
    const debtPayable = convertedSum(openDebts.filter(item => item.debt.kind === 'payable'), item => item.amount, item => item.debt.currency, item => item.debt.due || Core.today(), base);
    const receivableTotal = Core.round(receivable.total + debtReceivable.total);
    const dueTasks = (state.data.tasks || []).filter(task => !task.done && task.due && task.due <= Core.today());
    const dueFollowups = (state.data.followups || []).filter(item => item.status !== 'done' && item.due && item.due.slice(0, 10) <= Core.today());
    const recent = sorted(state.data.transactions).slice(0, 5);
    const missing = totals.missing_rates.length + receivable.missing + debtReceivable.missing + debtPayable.missing;

    return appHeader('حساباتي', 'Hesabati 1.0 · يعمل دون إنترنت') +
      '<section class="card hero-card"><div class="muted">صافي هذا الشهر</div><div class="hero-value">' + money(totals.profit, base) + '</div><div class="hero-foot"><span>' + (totals.profit >= 0 ? 'النتيجة موجبة' : 'المصاريف أعلى من الإيرادات') + '</span><button class="mini-button" data-route="reports">عرض التقرير</button></div></section>' +
      (missing ? '<div class="notice">هناك ' + missing + ' قيمة بعملة أخرى لم تدخل في الملخص. أضف سعر الصرف من صفحة العملات.</div>' : '') +
      '<div class="stats-grid"><section class="card stat-card positive"><span class="stat-label">إيرادات الشهر</span><strong class="stat-value">' + money(totals.income, base) + '</strong></section><section class="card stat-card negative"><span class="stat-label">مصاريف الشهر</span><strong class="stat-value">' + money(totals.expense, base) + '</strong></section></div>' +
      sectionHead('إجراءات سريعة') +
      '<div class="quick-grid"><button class="quick-action income" data-route="form/income"><span class="quick-icon">+</span>إيراد</button><button class="quick-action expense" data-route="form/expense"><span class="quick-icon">−</span>مصروف</button><button class="quick-action" data-route="form/order"><span class="quick-icon">▤</span>طلب</button><button class="quick-action" data-route="form/customer"><span class="quick-icon">♙</span>عميل</button></div>' +
      sectionHead('الذمم والمتابعة', 'التفاصيل', 'debts') +
      '<div class="stats-grid"><section class="card stat-card"><span class="stat-label">مستحقات لنا</span><strong class="stat-value">' + money(receivableTotal, base) + '</strong></section><section class="card stat-card"><span class="stat-label">مستحقات علينا</span><strong class="stat-value">' + money(debtPayable.total, base) + '</strong></section></div>' +
      ((dueTasks.length + dueFollowups.length) ? '<div class="notice info"><b>' + (dueTasks.length + dueFollowups.length) + ' متابعة تحتاج انتباهك اليوم.</b> <button class="mini-button" data-route="tasks">فتح المتابعات</button></div>' : '') +
      sectionHead('آخر الحركات', 'الكل', 'journal') +
      (recent.length ? '<div class="list">' + recent.map(transactionRow).join('') + '</div>' : empty('دفترك جاهز', 'سجّل أول إيراد أو مصروف لتظهر الحركات هنا.'));
  }

  function journalView() {
    const filter = state.journalFilter;
    const transactions = sorted(state.data.transactions).filter(transaction => {
      const flow = Core.journalFlow(transaction);
      if (filter === 'income') return flow.income > 0;
      if (filter === 'expense') return flow.expense > 0;
      if (filter === 'transfer') return ['transfer', 'fx_transfer'].includes(transaction.kind);
      return true;
    });
    const filters = [['all', 'الكل'], ['income', 'الإيرادات'], ['expense', 'المصاريف'], ['transfer', 'التحويلات']];
    return appHeader('دفتر الحركات', 'كل قيد له طرف مدين وطرف دائن') +
      '<div class="button-row"><button class="primary" data-route="form/income">+ إيراد</button><button class="secondary" data-route="form/expense">− مصروف</button><button class="secondary" data-route="form/transfer">تحويل</button></div>' +
      sectionHead('الحركات المسجلة') +
      '<div class="filter-bar">' + filters.map(item => '<button class="chip ' + (filter === item[0] ? 'active' : '') + '" data-action="journal-filter" data-value="' + item[0] + '">' + item[1] + '</button>').join('') + '</div>' +
      (transactions.length ? '<div class="list">' + transactions.map(transactionRow).join('') + '</div>' : empty('لا توجد حركات', 'غيّر المرشح أو أضف حركة مالية جديدة.'));
  }

  function transactionDetailView(id) {
    const transaction = byId('transactions', id);
    if (!transaction) return pageHeader('الحركة غير موجودة', '', 'journal') + empty('تعذر العثور عليها', 'قد تكون النسخة المستعادة لا تحتوي هذه الحركة.');
    const balances = Core.balanceByCurrency(transaction.entries || []);
    const allowedToVoid = !transaction.voided_at && !['reversal', 'order_payment', 'order_cost', 'cost_settlement', 'debt_opening', 'debt_settlement'].includes(transaction.kind);
    const rows = (transaction.entries || []).map(entry => '<div class="list-row"><span class="list-main"><span class="list-title">' + esc(accountName(entry.account_id)) + '</span><span class="list-subtitle">' + esc(entry.currency) + '</span></span><span class="list-side"><span class="tiny muted">مدين ' + money(entry.debit, entry.currency) + '</span><br><span class="tiny muted">دائن ' + money(entry.credit, entry.currency) + '</span></span></div>').join('');
    return pageHeader(transaction.description || labels[transaction.kind] || 'تفاصيل الحركة', labels[transaction.kind] || transaction.kind, 'journal') +
      '<section class="card"><div class="detail-grid"><div class="detail-cell"><span>المبلغ</span><strong>' + money(transaction.amount, transaction.currency) + '</strong></div><div class="detail-cell"><span>التاريخ</span><strong>' + dateLabel(transaction.date) + '</strong></div><div class="detail-cell"><span>القسم</span><strong>' + esc(labels[transaction.scope] || transaction.scope) + '</strong></div><div class="detail-cell"><span>التصنيف</span><strong>' + esc(categoryName(transaction.category_id)) + '</strong></div></div></section>' +
      '<div class="notice success">القيد متزن: ' + Object.entries(balances).map(item => esc(item[0]) + ' (' + money(item[1].debit, item[0]) + ' = ' + money(item[1].credit, item[0]) + ')').join(' · ') + '</div>' +
      sectionHead('أطراف القيد') + '<div class="list">' + rows + '</div>' +
      (transaction.voided_at ? '<div class="notice danger">تم عكس هذه الحركة بتاريخ ' + dateLabel(transaction.voided_at, true) + '، وبقيت في السجل للمراجعة.</div>' : '') +
      (allowedToVoid ? '<div class="form-actions"><button class="danger wide" data-action="void-transaction" data-id="' + attr(transaction.id) + '">عكس الحركة مع إبقاء أثرها</button></div>' : '');
  }

  function clientsView() {
    const isCustomers = state.crmTab === 'customers';
    const customers = sorted(state.data.customers);
    const orders = sorted(state.data.orders);
    let content = '';
    if (isCustomers) {
      content = customers.length ? '<div class="list">' + customers.map(customer => {
        const count = (state.data.orders || []).filter(order => order.customer_id === customer.id).length;
        return '<button class="list-row" data-route="customer/' + attr(customer.id) + '"><span class="row-icon">♙</span><span class="list-main"><span class="list-title">' + esc(customer.name) + '</span><span class="list-subtitle">' + esc(customer.phone || 'بدون رقم') + ' · ' + count + ' طلب</span></span><span>‹</span></button>';
      }).join('') + '</div>' : empty('لا يوجد عملاء بعد', 'أضف أول عميل ثم اربط به الطلبات والدفعات.');
    } else {
      content = orders.length ? '<div class="list">' + orders.map(order => {
        const metrics = Core.orderMetrics(order, state.data.payments, state.data.order_costs);
        return '<button class="list-row" data-route="order/' + attr(order.id) + '"><span class="row-icon">▤</span><span class="list-main"><span class="list-title">' + esc(order.title) + '</span><span class="list-subtitle">' + esc(customerName(order.customer_id)) + ' · ' + esc(labels[order.status] || order.status) + '</span></span><span class="list-side"><span class="list-amount">' + money(order.amount, order.currency) + '</span><span class="tiny muted">متبقي ' + money(metrics.due, order.currency) + '</span></span></button>';
      }).join('') + '</div>' : empty('لا توجد طلبات', 'أنشئ طلباً لتتبع قيمته ودفعاته وتكاليفه وربحه.');
    }
    return appHeader('العملاء والطلبات', 'من العرض إلى التحصيل والربح') +
      '<div class="segmented"><button class="' + (isCustomers ? 'active' : '') + '" data-action="crm-tab" data-value="customers">العملاء</button><button class="' + (!isCustomers ? 'active' : '') + '" data-action="crm-tab" data-value="orders">الطلبات</button></div>' +
      '<div class="button-row"><button class="primary" data-route="form/' + (isCustomers ? 'customer' : 'order') + '">+ ' + (isCustomers ? 'عميل جديد' : 'طلب جديد') + '</button><button class="secondary" data-route="form/' + (isCustomers ? 'order' : 'customer') + '">' + (isCustomers ? 'طلب جديد' : 'عميل جديد') + '</button></div>' +
      sectionHead(isCustomers ? 'كل العملاء' : 'كل الطلبات') + content;
  }

  function customerDetailView(id) {
    const customer = byId('customers', id);
    if (!customer) return pageHeader('العميل غير موجود', '', 'clients') + empty('تعذر العثور عليه', 'تحقق من النسخة الاحتياطية أو ارجع إلى قائمة العملاء.');
    const orders = (state.data.orders || []).filter(order => order.customer_id === id);
    const debts = (state.data.debts || []).filter(debt => debt.customer_id === id);
    const followups = (state.data.followups || []).filter(item => item.customer_id === id && item.status !== 'done');
    return pageHeader(customer.name, customer.phone || 'ملف العميل', 'clients') +
      '<section class="card"><div class="button-row">' + (customer.phone ? '<a class="secondary" href="tel:' + attr(customer.phone) + '">اتصال</a><a class="secondary" target="_blank" rel="noopener" href="https://wa.me/' + attr(customer.phone.replace(/\D/g, '')) + '">WhatsApp</a>' : '') + '<button class="secondary" data-route="form/followup?customer=' + attr(customer.id) + '">متابعة</button></div>' +
      (customer.notes ? '<p class="muted">' + esc(customer.notes) + '</p>' : '') + '</section>' +
      sectionHead('الطلبات (' + orders.length + ')', 'طلب جديد', 'form/order?customer=' + customer.id) +
      (orders.length ? '<div class="list">' + orders.map(order => '<button class="list-row" data-route="order/' + attr(order.id) + '"><span class="list-main"><span class="list-title">' + esc(order.title) + '</span><span class="list-subtitle">' + esc(labels[order.status] || order.status) + '</span></span><span class="list-amount">' + money(order.amount, order.currency) + '</span></button>').join('') + '</div>' : empty('لا توجد طلبات', 'أنشئ أول طلب لهذا العميل.')) +
      sectionHead('المستحقات والمتابعات') +
      '<section class="card"><p>مستحقات مرتبطة: <b>' + debts.length + '</b></p><p>متابعات مفتوحة: <b>' + followups.length + '</b></p></section>';
  }

  function orderDetailView(id) {
    const order = byId('orders', id);
    if (!order) return pageHeader('الطلب غير موجود', '', 'clients') + empty('تعذر العثور عليه', 'قد لا يكون موجوداً في النسخة الحالية.');
    const payments = sorted((state.data.payments || []).filter(item => item.order_id === id), 'date');
    const costs = sorted((state.data.order_costs || []).filter(item => item.order_id === id), 'date');
    const metrics = Core.orderMetrics(order, payments, costs);
    const paymentRows = payments.map(payment => '<div class="list-row"><span class="list-main"><span class="list-title">' + esc(payment.note || 'دفعة من العميل') + '</span><span class="list-subtitle">' + dateLabel(payment.date) + ' · ' + esc(accountName(payment.account_id)) + '</span></span><span class="list-amount income">+ ' + money(payment.amount, order.currency) + '</span></div>').join('');
    const costRows = costs.map(cost => {
      const remaining = Math.max(0, Core.round(cost.amount - (cost.paid_amount || 0)));
      return '<div class="list-row"><span class="list-main"><span class="list-title">' + esc(cost.description || 'تكلفة') + '</span><span class="list-subtitle">' + dateLabel(cost.date) + ' · ' + (remaining ? 'غير مدفوع بالكامل' : 'مدفوع') + '</span></span><span class="list-side"><span class="list-amount expense">− ' + money(cost.amount, order.currency) + '</span>' + (remaining ? '<button class="mini-button" data-route="form/cost-settlement?id=' + attr(cost.id) + '">تسديد</button>' : '') + '</span></div>';
    }).join('');
    return pageHeader(order.title, customerName(order.customer_id) + ' · ' + (labels[order.status] || order.status), 'clients') +
      '<section class="card"><div class="detail-grid"><div class="detail-cell"><span>قيمة الطلب</span><strong>' + money(metrics.total, order.currency) + '</strong></div><div class="detail-cell"><span>المدفوع</span><strong>' + money(metrics.paid, order.currency) + '</strong></div><div class="detail-cell"><span>المتبقي</span><strong>' + money(metrics.due, order.currency) + '</strong></div><div class="detail-cell"><span>إجمالي التكاليف</span><strong>' + money(metrics.total_costs, order.currency) + '</strong></div><div class="detail-cell"><span>الربح المتوقع</span><strong>' + money(metrics.expected_profit, order.currency) + '</strong></div><div class="detail-cell"><span>صافي النقد الحالي</span><strong>' + money(metrics.cash_profit, order.currency) + '</strong></div></div>' +
      (order.notes ? '<p class="muted">' + esc(order.notes) + '</p>' : '') + '</section>' +
      '<div class="button-row"><button class="primary" data-route="form/payment?id=' + attr(order.id) + '"' + (metrics.due <= 0 ? ' disabled' : '') + '>+ دفعة</button><button class="secondary" data-route="form/cost?id=' + attr(order.id) + '">+ تكلفة</button></div>' +
      sectionHead('الدفعات (' + payments.length + ')') + (payments.length ? '<div class="list">' + paymentRows + '</div>' : empty('لا توجد دفعات', 'قيمة الطلب لا تدخل الحساب النقدي حتى تسجل دفعة.')) +
      sectionHead('التكاليف (' + costs.length + ')') + (costs.length ? '<div class="list">' + costRows + '</div>' : empty('لا توجد تكاليف', 'أضف تكاليف الطلب ليظهر الربح الحقيقي.'));
  }

  function reportsView() {
    const base = state.preference.base_currency || 'TRY';
    const bounds = Core.periodBounds(state.reportMode, state.reportAnchor);
    const totals = Core.reportTotals(state.data.transactions || [], state.data.exchange_rates || [], base, bounds, state.reportScope);
    const max = Math.max(totals.income, totals.expense, 1);
    const incomeHeight = Math.max(3, Math.round(totals.income / max * 100));
    const expenseHeight = Math.max(3, Math.round(totals.expense / max * 100));
    const categoryMap = new Map();
    for (const transaction of (state.data.transactions || []).filter(item => Core.inPeriod(item, bounds) && (state.reportScope === 'all' || item.scope === state.reportScope))) {
      const flow = Core.journalFlow(transaction);
      if (!flow.income && !flow.expense) continue;
      const convertedIncome = Core.convertAmount(flow.income, transaction.currency, base, transaction.date, state.data.exchange_rates || []);
      const convertedExpense = Core.convertAmount(flow.expense, transaction.currency, base, transaction.date, state.data.exchange_rates || []);
      if (convertedIncome == null || convertedExpense == null) continue;
      const key = transaction.category_id || 'uncategorized';
      const current = categoryMap.get(key) || { income: 0, expense: 0 };
      current.income = Core.round(current.income + convertedIncome);
      current.expense = Core.round(current.expense + convertedExpense);
      categoryMap.set(key, current);
    }
    const breakdown = [...categoryMap.entries()].sort((a, b) => (b[1].income + b[1].expense) - (a[1].income + a[1].expense));
    const budgets = (state.data.budgets || []).filter(budget => budget.month === state.reportAnchor.slice(0, 7));
    const budgetCards = budgets.map(budget => {
      const actual = (state.data.transactions || []).filter(tx => tx.category_id === budget.category_id && tx.currency === budget.currency && tx.date.slice(0, 7) === budget.month)
        .reduce((total, tx) => total + Core.journalFlow(tx).expense, 0);
      const ratio = budget.amount ? actual / budget.amount : 0;
      return '<section class="card"><div class="hero-foot"><b>' + esc(categoryName(budget.category_id)) + '</b><span class="number">' + money(actual, budget.currency) + ' / ' + money(budget.amount, budget.currency) + '</span></div><div class="progress ' + (ratio > 1 ? 'over' : ratio > .8 ? 'warning' : '') + '"><span style="width:' + Math.min(100, Math.round(ratio * 100)) + '%"></span></div></section>';
    }).join('');
    return appHeader('التقارير', 'يومية وشهرية وسنوية بسعر الصرف المسجل') +
      '<div class="segmented">' + [['day', 'يومي'], ['month', 'شهري'], ['year', 'سنوي']].map(item => '<button class="' + (state.reportMode === item[0] ? 'active' : '') + '" data-action="report-mode" data-value="' + item[0] + '">' + item[1] + '</button>').join('') + '</div>' +
      '<div class="card form-card"><div class="field"><label>تاريخ التقرير</label><input type="date" value="' + attr(state.reportAnchor) + '" data-change="report-anchor"></div>' + scopeSegments(state.reportScope, 'report-scope') + '</div>' +
      '<div class="stats-grid"><section class="card stat-card positive"><span class="stat-label">الإيرادات</span><strong class="stat-value">' + money(totals.income, base) + '</strong></section><section class="card stat-card negative"><span class="stat-label">المصاريف</span><strong class="stat-value">' + money(totals.expense, base) + '</strong></section></div>' +
      '<section class="card"><span class="stat-label">صافي الربح</span><strong class="stat-value">' + money(totals.profit, base) + '</strong><div class="report-chart"><div class="chart-column"><div class="chart-track"><div class="chart-bar" style="height:' + incomeHeight + '%"></div></div><span>الإيرادات</span></div><div class="chart-column"><div class="chart-track"><div class="chart-bar expense" style="height:' + expenseHeight + '%"></div></div><span>المصاريف</span></div></div></section>' +
      (totals.missing_rates.length ? '<div class="notice">تم استبعاد ' + totals.missing_rates.length + ' حركة لعدم وجود سعر صرف في تاريخها.</div>' : '') +
      sectionHead('حسب التصنيف') +
      (breakdown.length ? '<div class="list">' + breakdown.map(item => '<div class="list-row"><span class="list-main"><span class="list-title">' + esc(categoryName(item[0])) + '</span></span><span class="list-side"><span class="tiny" style="color:var(--green)">+ ' + money(item[1].income, base) + '</span><br><span class="tiny" style="color:var(--red)">− ' + money(item[1].expense, base) + '</span></span></div>').join('') + '</div>' : empty('لا توجد بيانات للفترة', 'أضف حركات أو غيّر تاريخ التقرير.')) +
      sectionHead('ميزانيات الشهر', 'إدارة الميزانيات', 'budgets') + (budgetCards || empty('لا توجد ميزانية', 'حدد سقفاً شهرياً لأي تصنيف مصروف.'));
  }

  function moreView() {
    const menu = [
      ['accounts', '▣', 'الحسابات', 'أرصدة نقدية وبنكية متعددة'],
      ['debts', '⇄', 'الديون والتسويات', 'مستحقات ودفعات جزئية'],
      ['budgets', '◫', 'التصنيفات والميزانيات', 'خطط شهرية مقابل الفعلي'],
      ['exchange', '¤', 'العملات وسعر الصرف', 'أسعار مؤرخة وتحويلات'],
      ['tasks', '✓', 'المهام والمتابعات', 'مواعيد مرتبطة بالعملاء'],
      ['settings', '⚙', 'النسخ الاحتياطي', 'تصدير واستعادة وفحص البيانات']
    ];
    return appHeader('المزيد', 'أدوات إدارة الحسابات والبيانات') +
      '<div class="menu-grid">' + menu.map(item => '<button class="menu-card" data-route="' + item[0] + '"><span class="menu-icon">' + item[1] + '</span><b>' + item[2] + '</b><span>' + item[3] + '</span></button>').join('') + '</div>' +
      '<div class="notice info" style="margin-top:16px">الإصدار 1.0.0 · البيانات محفوظة في قاعدة IndexedDB على هذا الجهاز، والتطبيق يعمل دون إنترنت بعد أول فتح.</div>';
  }

  function accountsView() {
    const rows = accounts().map(account => {
      const balance = Core.accountBalance(account.id, state.data.transactions || []);
      return '<div class="list-row"><span class="row-icon">▣</span><span class="list-main"><span class="list-title">' + esc(account.name) + '</span><span class="list-subtitle">' + esc(labels[account.scope] || account.scope || 'العمل') + ' · ' + esc(account.currency) + '</span></span><span class="list-amount">' + money(balance, account.currency) + '</span></div>';
    }).join('');
    return pageHeader('الحسابات', 'الأرصدة ناتجة عن دفتر الحركات المتزن', 'more') +
      '<button class="primary wide" data-route="form/account">+ حساب جديد</button>' +
      sectionHead('كل الحسابات (' + accounts().length + ')') + '<div class="list">' + rows + '</div>' +
      '<div class="notice info">الرصيد الافتتاحي يُسجّل كقيد مستقل. التحويل لا يُعد دخلاً أو مصروفاً.</div>';
  }

  function debtsView() {
    const debts = sorted(state.data.debts);
    const rows = debts.map(debt => {
      const balance = Core.debtBalance(debt, state.data.debt_settlements);
      const party = debt.customer_id ? customerName(debt.customer_id) : (debt.party || 'طرف آخر');
      return '<div class="list-row"><span class="list-main"><span class="list-title">' + esc(debt.title) + '</span><span class="list-subtitle">' + esc(labels[debt.kind]) + ' · ' + esc(party) + ' · ' + dateLabel(debt.due) + '</span></span><span class="list-side"><span class="list-amount ' + (debt.kind === 'receivable' ? 'income' : 'expense') + '">' + money(balance, debt.currency) + '</span>' + (balance > 0 ? '<button class="mini-button" data-route="form/debt-settlement?id=' + attr(debt.id) + '">تسوية</button>' : pill('مسدد', 'green')) + '</span></div>';
    }).join('');
    return pageHeader('الديون والتسويات', 'تحصيل أو سداد جزئي مع أثر نقدي', 'more') +
      '<button class="primary wide" data-route="form/debt">+ مستحق جديد</button>' +
      sectionHead('كل المستحقات') + (rows ? '<div class="list">' + rows + '</div>' : empty('لا توجد مستحقات', 'أضف ديناً لك أو عليك ثم سجّل تسوياته.'));
  }

  function budgetsView() {
    const budgets = sorted(state.data.budgets, 'month');
    const categories = state.data.categories || [];
    return pageHeader('التصنيفات والميزانيات', 'خطط شهرية لكل تصنيف وعملة', 'more') +
      '<div class="button-row"><button class="primary" data-route="form/budget">+ ميزانية</button><button class="secondary" data-route="form/category">+ تصنيف</button></div>' +
      sectionHead('الميزانيات') +
      (budgets.length ? '<div class="list">' + budgets.map(budget => '<div class="list-row"><span class="list-main"><span class="list-title">' + esc(categoryName(budget.category_id)) + '</span><span class="list-subtitle">' + esc(budget.month) + ' · ' + esc(labels[budget.scope] || budget.scope) + '</span></span><span class="list-amount">' + money(budget.amount, budget.currency) + '</span></div>').join('') + '</div>' : empty('لا توجد ميزانيات', 'أضف سقفاً شهرياً لمصروف محدد.')) +
      sectionHead('التصنيفات (' + categories.length + ')') +
      '<div class="list">' + categories.map(category => '<div class="list-row"><span class="list-main"><span class="list-title">' + esc(category.name) + '</span><span class="list-subtitle">' + esc(labels[category.type] || category.type) + ' · ' + esc(labels[category.scope] || category.scope) + '</span></span>' + (category.system ? pill('أساسي') : '') + '</div>').join('') + '</div>';
  }

  function exchangeView() {
    const rates = sorted(state.data.exchange_rates, 'date');
    return pageHeader('العملات وسعر الصرف', 'يُستخدم السعر الأحدث في تاريخ الحركة', 'more') +
      '<div class="button-row"><button class="primary" data-route="form/rate">+ سعر صرف</button><button class="secondary" data-route="form/transfer">تحويل عملة</button></div>' +
      sectionHead('الأسعار المسجلة') +
      (rates.length ? '<div class="list">' + rates.map(rate => '<div class="list-row"><span class="list-main"><span class="list-title">1 ' + esc(rate.from_currency) + ' = ' + esc(Core.round(rate.rate)) + ' ' + esc(rate.to_currency) + '</span><span class="list-subtitle">' + dateLabel(rate.date) + '</span></span></div>').join('') + '</div>' : empty('لا توجد أسعار صرف', 'سجّل الأسعار التي تحتاجها لتوحيد التقارير بين العملات.')) +
      '<div class="notice info">كل حركة تبقى بعملتها الأصلية. سعر الصرف يؤثر على التقارير الموحّدة فقط ولا يغيّر السجل التاريخي.</div>';
  }

  function tasksView() {
    const tasks = sorted(state.data.tasks, 'due');
    const followups = sorted(state.data.followups, 'due');
    return pageHeader('المهام والمتابعات', 'مواعيد العمل والعملاء في مكان واحد', 'more') +
      '<div class="button-row"><button class="primary" data-route="form/task">+ مهمة</button><button class="secondary" data-route="form/followup">+ متابعة عميل</button></div>' +
      sectionHead('المهام') +
      (tasks.length ? '<div class="list">' + tasks.map(task => '<div class="list-row"><span class="list-main"><span class="list-title">' + esc(task.title) + '</span><span class="list-subtitle">' + dateLabel(task.due) + ' · ' + esc(labels[task.scope] || task.scope) + '</span></span><button class="mini-button" data-action="toggle-task" data-id="' + attr(task.id) + '">' + (task.done ? 'إعادة فتح' : 'إنهاء') + '</button></div>').join('') + '</div>' : empty('لا توجد مهام', 'أضف مهمة شخصية أو للعمل أو البيت.')) +
      sectionHead('متابعات العملاء') +
      (followups.length ? '<div class="list">' + followups.map(item => '<div class="list-row"><span class="list-main"><span class="list-title">' + esc(item.title) + '</span><span class="list-subtitle">' + dateLabel(item.due, true) + ' · ' + esc(customerName(item.customer_id)) + '</span></span><button class="mini-button" data-action="toggle-followup" data-id="' + attr(item.id) + '">' + (item.status === 'done' ? 'إعادة فتح' : 'إنهاء') + '</button></div>').join('') + '</div>' : empty('لا توجد متابعات', 'أضف موعد اتصال أو متابعة مع عميل.'));
  }

  function settingsView() {
    const integrity = state.integrity;
    return pageHeader('البيانات والنسخ الاحتياطي', 'الاستعادة تستبدل البيانات بعد إنشاء نسخة أمان', 'more') +
      (state.migration?.migrated ? '<div class="notice success">تم ترحيل بيانات الإصدار 0.2 بنجاح، وحُفظت نسخة داخلية قبل الترحيل.</div>' : '') +
      '<section class="card"><b>نسخة احتياطية كاملة</b><p class="muted">تتضمن الحسابات والحركات والعملاء والطلبات والديون والأسعار والميزانيات.</p><div class="button-row"><button class="primary" data-action="export">تصدير JSON</button><button class="secondary" data-action="restore">استعادة</button></div></section>' +
      '<section class="card"><b>فحص سلامة الدفتر</b><p class="muted">يتحقق من اتزان القيود والروابط والمعرّفات المكررة.</p><button class="secondary wide" data-action="integrity">تشغيل الفحص</button>' +
      (integrity ? '<div class="notice ' + (integrity.ok ? 'success' : 'danger') + '" style="margin-top:12px">' + (integrity.ok ? 'كل القيود متزنة ولم تظهر مشكلات.' : 'وجد الفحص ' + integrity.issues.length + ' مشكلة تحتاج مراجعة.') + '</div>' : '') + '</section>' +
      '<section class="card"><b>الإعدادات</b><div class="field" style="margin-top:14px"><label>عملة التقرير الرئيسية</label><select data-change="base-currency">' + currencyOptions(state.preference.base_currency) + '</select></div><div class="field"><label>القسم الافتراضي</label><select data-change="default-scope">' + optionList([['work', 'العمل'], ['personal', 'شخصي'], ['home', 'البيت']], state.preference.default_scope) + '</select></div></section>' +
      '<section class="card"><b>الترحيل الآمن</b><p class="muted">عدد نقاط الأمان الداخلية: ' + state.backupCount + '. لا تُحذف جداول 0.2 أثناء الترقية، وتبقى النسخة السابقة محفوظة محلياً.</p></section>' +
      '<div class="notice danger">لا تحذف بيانات Safari ولا تزل التطبيق من الشاشة الرئيسية قبل تصدير نسخة احتياطية إلى Files أو iCloud Drive.</div>';
  }

  function field(label, control, help) {
    return '<div class="field"><label>' + esc(label) + '</label>' + control + (help ? '<small>' + esc(help) + '</small>' : '') + '</div>';
  }

  function input(name, type, value, extra) {
    return '<input name="' + attr(name) + '" type="' + attr(type || 'text') + '" value="' + attr(value == null ? '' : value) + '" ' + (extra || '') + '>';
  }

  function select(name, options, extra) {
    return '<select name="' + attr(name) + '" ' + (extra || '') + '>' + options + '</select>';
  }

  function formView(type, query) {
    const now = Core.today();
    const scope = state.preference.default_scope || 'work';
    let title = '';
    let subtitle = '';
    let body = '';
    let back = 'more';
    let submit = 'حفظ';

    if (type === 'income' || type === 'expense') {
      const isIncome = type === 'income';
      title = isIncome ? 'إيراد جديد' : 'مصروف جديد';
      subtitle = 'سيُنشأ قيد محاسبي متزن تلقائياً';
      back = 'journal';
      body = field('المبلغ *', input('amount', 'number', '', 'min="0.01" step="0.01" inputmode="decimal" required autofocus')) +
        field('الحساب *', select('account_id', accountOptions('', ''), 'required')) +
        field('التصنيف', select('category_id', categoryOptions(type, ''))) +
        '<div class="field-inline">' + field('القسم', select('scope', optionList([['work', 'العمل'], ['personal', 'شخصي'], ['home', 'البيت']], scope))) + field('التاريخ', input('date', 'date', now, 'required')) + '</div>' +
        field('الوصف *', input('description', 'text', '', 'required maxlength="160" placeholder="' + (isIncome ? 'مثال: مبيعات اليوم' : 'مثال: شراء مواد') + '"'));
    } else if (type === 'account') {
      title = 'حساب جديد'; subtitle = 'نقدي أو بنك أو محفظة بأي عملة'; back = 'accounts';
      body = field('اسم الحساب *', input('name', 'text', '', 'required maxlength="100" autofocus')) +
        '<div class="field-inline">' + field('العملة', select('currency', currencyOptions('TRY'))) + field('القسم', select('scope', optionList([['work', 'العمل'], ['personal', 'شخصي'], ['home', 'البيت']], scope))) + '</div>' +
        field('الرصيد الافتتاحي', input('opening', 'number', '0', 'step="0.01" inputmode="decimal"'), 'يمكن إدخال رصيد سالب، وسيُحفظ كقيد افتتاحي مستقل.');
    } else if (type === 'transfer') {
      title = 'تحويل بين حسابين'; subtitle = 'يدعم التحويل بين عملتين وسعر صرف مؤرخ'; back = 'journal';
      body = field('من حساب *', select('from_account_id', accountOptions('', ''), 'required')) +
        field('إلى حساب *', select('to_account_id', accountOptions('', ''), 'required')) +
        '<div class="field-inline">' + field('المبلغ المرسل *', input('from_amount', 'number', '', 'min="0.01" step="0.01" required inputmode="decimal"')) + field('المبلغ المستلم *', input('to_amount', 'number', '', 'min="0.01" step="0.01" required inputmode="decimal"')) + '</div>' +
        field('التاريخ', input('date', 'date', now, 'required')) + field('الوصف', input('description', 'text', 'تحويل بين الحسابات', 'maxlength="160"')) +
        '<div class="notice info">إذا اختلفت عملتا الحسابين، يُحفظ سعر الصرف الناتج تلقائياً في تاريخ التحويل.</div>';
    } else if (type === 'customer') {
      title = 'عميل جديد'; subtitle = 'بيانات الاتصال والطلبات المرتبطة'; back = 'clients';
      body = field('اسم العميل *', input('name', 'text', '', 'required maxlength="120" autofocus')) +
        field('رقم الهاتف', input('phone', 'tel', '', 'inputmode="tel"')) +
        field('ملاحظات', '<textarea name="notes" maxlength="1000"></textarea>');
    } else if (type === 'order') {
      const customer = query.get('customer') || '';
      title = 'طلب جديد'; subtitle = 'القيمة لا تدخل النقد حتى تسجيل دفعة'; back = 'clients';
      body = field('العميل *', select('customer_id', '<option value="">اختر العميل</option>' + optionList(state.data.customers || [], customer), 'required')) +
        field('عنوان الطلب *', input('title', 'text', '', 'required maxlength="160" autofocus')) +
        '<div class="field-inline">' + field('قيمة الطلب', input('amount', 'number', '0', 'min="0" step="0.01" required inputmode="decimal"')) + field('العملة', select('currency', currencyOptions('TRY'))) + '</div>' +
        '<div class="field-inline">' + field('الحالة', select('status', optionList([['new', 'جديد'], ['progress', 'قيد التنفيذ'], ['waiting', 'بانتظار العميل'], ['done', 'مكتمل'], ['cancelled', 'ملغي']], 'new'))) + field('موعد التسليم', input('due', 'date', '')) + '</div>' +
        field('القسم', select('scope', optionList([['work', 'العمل'], ['personal', 'شخصي'], ['home', 'البيت']], 'work'))) +
        field('ملاحظات', '<textarea name="notes" maxlength="1000"></textarea>');
    } else if (type === 'payment') {
      const order = byId('orders', query.get('id'));
      if (!order) return pageHeader('الطلب غير موجود', '', 'clients') + empty('تعذر تسجيل الدفعة', 'ارجع إلى الطلب وحاول مرة أخرى.');
      const metrics = Core.orderMetrics(order, state.data.payments, state.data.order_costs);
      title = 'دفعة للطلب'; subtitle = order.title; back = 'order/' + order.id;
      body = '<input type="hidden" name="order_id" value="' + attr(order.id) + '">' +
        '<div class="notice success">المتبقي على العميل: <b>' + money(metrics.due, order.currency) + '</b></div>' +
        field('المبلغ *', input('amount', 'number', metrics.due, 'min="0.01" max="' + metrics.due + '" step="0.01" required inputmode="decimal" autofocus')) +
        field('الحساب المستلم *', select('account_id', accountOptions('', order.currency), 'required')) +
        field('تاريخ الدفع', input('date', 'date', now, 'required')) + field('ملاحظة', input('note', 'text', 'دفعة: ' + order.title, 'maxlength="160"'));
    } else if (type === 'cost') {
      const order = byId('orders', query.get('id'));
      if (!order) return pageHeader('الطلب غير موجود', '', 'clients') + empty('تعذر تسجيل التكلفة', 'ارجع إلى الطلب وحاول مرة أخرى.');
      title = 'تكلفة للطلب'; subtitle = order.title; back = 'order/' + order.id;
      body = '<input type="hidden" name="order_id" value="' + attr(order.id) + '">' +
        field('الوصف *', input('description', 'text', '', 'required maxlength="160" autofocus placeholder="مثال: مواد أو شحن"')) +
        field('المبلغ *', input('amount', 'number', '', 'min="0.01" step="0.01" required inputmode="decimal"')) +
        '<label class="check-line"><input type="checkbox" name="paid" value="1" checked data-change="cost-paid"> مدفوعة الآن</label>' +
        '<div id="cost-account">' + field('حساب الدفع *', select('account_id', accountOptions('', order.currency))) + '</div>' +
        field('التاريخ', input('date', 'date', now, 'required'));
    } else if (type === 'cost-settlement') {
      const cost = byId('order_costs', query.get('id'));
      const order = cost && byId('orders', cost.order_id);
      if (!cost || !order) return pageHeader('التكلفة غير موجودة', '', 'clients') + empty('تعذر تسجيل التسديد', 'ارجع إلى الطلب وحاول مرة أخرى.');
      const remaining = Core.round(cost.amount - (cost.paid_amount || 0));
      title = 'تسديد تكلفة'; subtitle = cost.description; back = 'order/' + order.id;
      body = '<input type="hidden" name="cost_id" value="' + attr(cost.id) + '">' +
        '<div class="notice">المتبقي: <b>' + money(remaining, cost.currency) + '</b></div>' +
        field('المبلغ *', input('amount', 'number', remaining, 'min="0.01" max="' + remaining + '" step="0.01" required')) +
        field('حساب الدفع *', select('account_id', accountOptions('', cost.currency), 'required')) +
        field('التاريخ', input('date', 'date', now, 'required'));
    } else if (type === 'debt') {
      title = 'مستحق جديد'; subtitle = 'دين لك أو عليك مع تسويات جزئية'; back = 'debts';
      body = field('الوصف *', input('title', 'text', '', 'required maxlength="160" autofocus')) +
        field('نوع المستحق', select('kind', optionList([['receivable', 'لنا عند الغير'], ['payable', 'علينا للغير']], 'receivable'))) +
        field('العميل', select('customer_id', '<option value="">بدون عميل</option>' + optionList(state.data.customers || [], ''))) +
        field('اسم الطرف', input('party', 'text', '', 'maxlength="120"')) +
        '<div class="field-inline">' + field('المبلغ *', input('amount', 'number', '', 'min="0.01" step="0.01" required')) + field('العملة', select('currency', currencyOptions('TRY'))) + '</div>' +
        field('تاريخ الاستحقاق', input('due', 'date', '')) + field('ملاحظات', '<textarea name="notes"></textarea>') +
        '<div class="notice">فتح المستحق لا يحرك النقد. يُسجّل مقابل رصيد التسويات، ثم تتحرك الأموال عند كل سداد.</div>';
    } else if (type === 'debt-settlement') {
      const debt = byId('debts', query.get('id'));
      if (!debt) return pageHeader('المستحق غير موجود', '', 'debts') + empty('تعذر تسجيل التسوية', 'ارجع إلى قائمة الديون وحاول مرة أخرى.');
      const remaining = Core.debtBalance(debt, state.data.debt_settlements);
      title = 'تسوية مستحق'; subtitle = debt.title; back = 'debts';
      body = '<input type="hidden" name="debt_id" value="' + attr(debt.id) + '">' +
        '<div class="notice ' + (debt.kind === 'receivable' ? 'success' : '') + '">المتبقي: <b>' + money(remaining, debt.currency) + '</b> · ' + esc(labels[debt.kind]) + '</div>' +
        field('المبلغ *', input('amount', 'number', remaining, 'min="0.01" max="' + remaining + '" step="0.01" required')) +
        field(debt.kind === 'receivable' ? 'الحساب المستلم *' : 'حساب الدفع *', select('account_id', accountOptions('', debt.currency), 'required')) +
        field('التاريخ', input('date', 'date', now, 'required')) + field('ملاحظة', input('note', 'text', 'تسوية: ' + debt.title, 'maxlength="160"'));
    } else if (type === 'category') {
      title = 'تصنيف جديد'; subtitle = 'استخدمه في الحركات والميزانيات'; back = 'budgets';
      body = field('اسم التصنيف *', input('name', 'text', '', 'required maxlength="100" autofocus')) +
        field('النوع', select('type', optionList([['income', 'إيراد'], ['expense', 'مصروف']], 'expense'))) +
        field('القسم', select('scope', optionList([['work', 'العمل'], ['personal', 'شخصي'], ['home', 'البيت']], scope)));
    } else if (type === 'budget') {
      title = 'ميزانية شهرية'; subtitle = 'سقف مصروف لتصنيف واحد'; back = 'budgets';
      const expenseCategories = (state.data.categories || []).filter(item => item.type === 'expense');
      body = field('التصنيف *', select('category_id', optionList(expenseCategories, ''), 'required')) +
        field('الشهر *', input('month', 'month', now.slice(0, 7), 'required')) +
        '<div class="field-inline">' + field('المبلغ *', input('amount', 'number', '', 'min="0.01" step="0.01" required')) + field('العملة', select('currency', currencyOptions('TRY'))) + '</div>' +
        field('القسم', select('scope', optionList([['work', 'العمل'], ['personal', 'شخصي'], ['home', 'البيت']], scope)));
    } else if (type === 'rate') {
      title = 'سعر صرف'; subtitle = 'السعر يصبح صالحاً من التاريخ المحدد'; back = 'exchange';
      body = '<div class="field-inline">' + field('من عملة', select('from_currency', currencyOptions('USD'))) + field('إلى عملة', select('to_currency', currencyOptions('TRY'))) + '</div>' +
        field('السعر *', input('rate', 'number', '', 'min="0.000001" step="0.000001" required inputmode="decimal" autofocus'), 'مثال: إذا كان 1 USD = 34 TRY فاكتب 34.') +
        field('التاريخ', input('date', 'date', now, 'required'));
    } else if (type === 'task') {
      title = 'مهمة جديدة'; subtitle = 'مهمة مستقلة للعمل أو البيت'; back = 'tasks';
      body = field('المهمة *', input('title', 'text', '', 'required maxlength="160" autofocus')) +
        field('القسم', select('scope', optionList([['work', 'العمل'], ['personal', 'شخصي'], ['home', 'البيت']], scope))) +
        field('الموعد', input('due', 'date', '')) + field('ملاحظات', '<textarea name="notes"></textarea>');
    } else if (type === 'followup') {
      const customer = query.get('customer') || '';
      title = 'متابعة عميل'; subtitle = 'موعد اتصال أو إجراء مرتبط بعميل'; back = 'tasks';
      body = field('عنوان المتابعة *', input('title', 'text', '', 'required maxlength="160" autofocus')) +
        field('العميل', select('customer_id', '<option value="">متابعة عامة</option>' + optionList(state.data.customers || [], customer))) +
        field('الموعد *', input('due', 'datetime-local', '', 'required')) + field('ملاحظات', '<textarea name="notes"></textarea>');
    } else {
      return pageHeader('نموذج غير معروف', '', 'home') + empty('تعذر فتح الصفحة', 'ارجع إلى الصفحة الرئيسية.');
    }

    return pageHeader(title, subtitle, back) + '<form class="form-card card" data-form="' + attr(type) + '">' + body +
      '<div class="form-actions"><button class="primary wide" type="submit">' + esc(submit) + '</button></div></form>';
  }

  function viewFor(path, query) {
    if (path === 'home') return homeView();
    if (path === 'journal') return journalView();
    if (path.startsWith('transaction/')) return transactionDetailView(path.split('/')[1]);
    if (path === 'clients') return clientsView();
    if (path.startsWith('customer/')) return customerDetailView(path.split('/')[1]);
    if (path.startsWith('order/')) return orderDetailView(path.split('/')[1]);
    if (path === 'reports') return reportsView();
    if (path === 'more') return moreView();
    if (path === 'accounts') return accountsView();
    if (path === 'debts') return debtsView();
    if (path === 'budgets') return budgetsView();
    if (path === 'exchange') return exchangeView();
    if (path === 'tasks') return tasksView();
    if (path === 'settings') return settingsView();
    if (path.startsWith('form/')) return formView(path.split('/')[1], query);
    return homeView();
  }

  async function refresh(options) {
    const info = routeInfo();
    try {
      state.data = await DB.snapshot(DB.EXPORT_STORES);
      state.preference = await DB.getPreference();
      state.backupCount = (await DB.internalBackups()).length;
      app.innerHTML = layout(viewFor(info.path, info.query), info.path);
      if (!options?.keepScroll) window.scrollTo(0, 0);
    } catch (error) {
      console.error(error);
      app.innerHTML = '<main class="page-wrap">' + appHeader('تعذر فتح البيانات') + '<div class="notice danger">' + esc(error.message || 'خطأ غير معروف') + '</div></main>';
    }
  }

  function toast(message, error) {
    toastNode.textContent = message;
    toastNode.className = 'toast show' + (error ? ' error' : '');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { toastNode.className = 'toast'; }, 2600);
  }

  function formObject(form) {
    const result = Object.fromEntries(new FormData(form).entries());
    result.created_at = new Date().toISOString();
    return result;
  }

  async function submitForm(form) {
    const type = form.dataset.form;
    const value = formObject(form);
    const now = value.created_at;
    try {
      if (type === 'income' || type === 'expense') {
        const account = byId('accounts', value.account_id);
        if (!account) throw new Error('اختر حساباً صالحاً');
        const make = type === 'income' ? Core.incomeJournal : Core.expenseJournal;
        const journal = make({
          id: Core.uid('txn'), amount: value.amount, account_id: account.id, currency: account.currency,
          category_id: value.category_id, scope: value.scope, date: value.date,
          description: value.description, created_at: now
        });
        await DB.commit({ transactions: [journal] }, { action: 'create', entity_type: 'transaction', entity_id: journal.id, details: { kind: type } });
        toast('تم حفظ الحركة وقيدها متزن');
        route('journal');
      } else if (type === 'account') {
        const account = { id: Core.uid('account'), name: value.name.trim(), currency: value.currency, scope: value.scope, account_type: 'asset', hidden: false, created_at: now, opening: 0 };
        const opening = Core.openingBalanceJournal({ id: Core.uid('txn'), account_id: account.id, amount: value.opening, currency: account.currency, scope: account.scope, date: Core.today(), created_at: now, description: 'رصيد افتتاحي: ' + account.name });
        await DB.commit({ accounts: [account], transactions: opening ? [opening] : [] }, { action: 'create', entity_type: 'account', entity_id: account.id, details: { opening: Core.round(value.opening) } });
        toast('تم إنشاء الحساب');
        route('accounts');
      } else if (type === 'transfer') {
        const from = byId('accounts', value.from_account_id);
        const to = byId('accounts', value.to_account_id);
        if (!from || !to) throw new Error('اختر حسابين صالحين');
        if (from.id === to.id) throw new Error('اختر حسابين مختلفين');
        let journal;
        const extra = {};
        if (from.currency === to.currency) {
          if (Math.abs(Number(value.from_amount) - Number(value.to_amount)) > Core.EPSILON) throw new Error('في العملة نفسها يجب أن يتساوى المبلغ المرسل والمستلم');
          journal = Core.transferJournal({ id: Core.uid('txn'), from_account_id: from.id, to_account_id: to.id, amount: value.from_amount, currency: from.currency, date: value.date, created_at: now, description: value.description, scope: from.scope || 'work' });
        } else {
          journal = Core.fxTransferJournal({ id: Core.uid('txn'), from_account_id: from.id, to_account_id: to.id, from_amount: value.from_amount, to_amount: value.to_amount, from_currency: from.currency, to_currency: to.currency, date: value.date, created_at: now, description: value.description, scope: from.scope || 'work' });
          extra.exchange_rates = [{ id: Core.uid('rate'), from_currency: from.currency, to_currency: to.currency, rate: Core.round(Number(value.to_amount) / Number(value.from_amount)), date: value.date, created_at: now, source: 'transfer', transaction_id: journal.id }];
        }
        await DB.commit({ transactions: [journal], ...extra }, { action: 'create', entity_type: 'transaction', entity_id: journal.id, details: { kind: journal.kind } });
        toast('تم التحويل وحفظ القيد');
        route('journal');
      } else if (type === 'customer') {
        const customer = { id: Core.uid('customer'), name: value.name.trim(), phone: value.phone.trim(), notes: value.notes.trim(), created_at: now };
        await DB.commit({ customers: [customer] }, { action: 'create', entity_type: 'customer', entity_id: customer.id, details: {} });
        toast('تمت إضافة العميل');
        route('customer/' + customer.id);
      } else if (type === 'order') {
        const order = { id: Core.uid('order'), customer_id: value.customer_id, title: value.title.trim(), amount: Core.round(value.amount), currency: value.currency, status: value.status, due: value.due, scope: value.scope, notes: value.notes.trim(), accounting_status: 'cash_basis', created_at: now };
        await DB.commit({ orders: [order] }, { action: 'create', entity_type: 'order', entity_id: order.id, details: {} });
        toast('تم إنشاء الطلب');
        route('order/' + order.id);
      } else if (type === 'payment') {
        const order = byId('orders', value.order_id);
        if (!order) throw new Error('الطلب غير موجود');
        const account = byId('accounts', value.account_id);
        if (!account || account.currency !== order.currency) throw new Error('عملة الحساب لا تطابق عملة الطلب');
        const metrics = Core.orderMetrics(order, state.data.payments, state.data.order_costs);
        const amount = Core.positiveAmount(value.amount);
        if (amount > metrics.due + Core.EPSILON) throw new Error('الدفعة تتجاوز المبلغ المتبقي');
        const payment = { id: Core.uid('payment'), order_id: order.id, amount, currency: order.currency, account_id: account.id, date: value.date, note: value.note.trim(), created_at: now };
        const journal = Core.incomeJournal({ id: Core.uid('txn'), kind: 'order_payment', amount, account_id: account.id, currency: order.currency, date: value.date, created_at: now, description: value.note || 'دفعة: ' + order.title, category_id: 'cat:sales', scope: order.scope || 'work', reference_type: 'payment', reference_id: payment.id });
        payment.transaction_id = journal.id;
        await DB.commit({ payments: [payment], transactions: [journal] }, { action: 'create', entity_type: 'payment', entity_id: payment.id, details: { order_id: order.id } });
        toast('تم تسجيل الدفعة وإضافتها للحساب');
        route('order/' + order.id);
      } else if (type === 'cost') {
        const order = byId('orders', value.order_id);
        if (!order) throw new Error('الطلب غير موجود');
        const paid = value.paid === '1';
        const account = paid ? byId('accounts', value.account_id) : null;
        if (paid && (!account || account.currency !== order.currency)) throw new Error('اختر حساب دفع بعملة الطلب');
        const amount = Core.positiveAmount(value.amount);
        const cost = { id: Core.uid('cost'), order_id: order.id, description: value.description.trim(), amount, paid_amount: paid ? amount : 0, currency: order.currency, account_id: paid ? account.id : '', date: value.date, created_at: now };
        const journal = Core.orderCostJournal({ id: Core.uid('txn'), amount, paid, account_id: paid ? account.id : '', currency: order.currency, date: value.date, created_at: now, description: 'تكلفة: ' + cost.description, category_id: 'cat:supplies', scope: order.scope || 'work', reference_id: cost.id });
        cost.transaction_id = journal.id;
        await DB.commit({ order_costs: [cost], transactions: [journal] }, { action: 'create', entity_type: 'order_cost', entity_id: cost.id, details: { order_id: order.id, paid } });
        toast('تم تسجيل التكلفة');
        route('order/' + order.id);
      } else if (type === 'cost-settlement') {
        const cost = byId('order_costs', value.cost_id);
        const order = cost && byId('orders', cost.order_id);
        const account = byId('accounts', value.account_id);
        if (!cost || !order || !account) throw new Error('بيانات التسديد غير مكتملة');
        if (account.currency !== cost.currency) throw new Error('عملة الحساب لا تطابق التكلفة');
        const amount = Core.positiveAmount(value.amount);
        const remaining = Core.round(cost.amount - (cost.paid_amount || 0));
        if (amount > remaining + Core.EPSILON) throw new Error('المبلغ يتجاوز المتبقي');
        const journal = Core.costSettlementJournal({ id: Core.uid('txn'), amount, account_id: account.id, currency: cost.currency, date: value.date, created_at: now, description: 'تسديد تكلفة: ' + cost.description, scope: order.scope || 'work', reference_id: cost.id });
        const updated = { ...cost, paid_amount: Core.round((cost.paid_amount || 0) + amount), updated_at: now };
        await DB.commit({ order_costs: [updated], transactions: [journal] }, { action: 'settle', entity_type: 'order_cost', entity_id: cost.id, details: { amount } });
        toast('تم تسديد التكلفة');
        route('order/' + order.id);
      } else if (type === 'debt') {
        const amount = Core.positiveAmount(value.amount);
        const debt = { id: Core.uid('debt'), title: value.title.trim(), kind: value.kind, customer_id: value.customer_id, party: value.party.trim(), amount, currency: value.currency, due: value.due, notes: value.notes.trim(), status: 'open', created_at: now };
        const journal = Core.debtOpeningJournal({ id: Core.uid('txn'), kind: debt.kind, amount, currency: debt.currency, date: Core.today(), created_at: now, description: 'فتح مستحق: ' + debt.title, reference_id: debt.id, scope: 'work' });
        debt.transaction_id = journal.id;
        await DB.commit({ debts: [debt], transactions: [journal] }, { action: 'create', entity_type: 'debt', entity_id: debt.id, details: { kind: debt.kind } });
        toast('تم فتح المستحق');
        route('debts');
      } else if (type === 'debt-settlement') {
        const debt = byId('debts', value.debt_id);
        const account = byId('accounts', value.account_id);
        if (!debt || !account) throw new Error('بيانات التسوية غير مكتملة');
        if (account.currency !== debt.currency) throw new Error('عملة الحساب لا تطابق المستحق');
        const amount = Core.positiveAmount(value.amount);
        const remaining = Core.debtBalance(debt, state.data.debt_settlements);
        if (amount > remaining + Core.EPSILON) throw new Error('المبلغ يتجاوز المتبقي');
        const settlement = { id: Core.uid('settlement'), debt_id: debt.id, amount, currency: debt.currency, account_id: account.id, date: value.date, note: value.note.trim(), created_at: now };
        const journal = Core.debtSettlementJournal({ id: Core.uid('txn'), kind: debt.kind, amount, account_id: account.id, currency: debt.currency, date: value.date, created_at: now, description: settlement.note || 'تسوية: ' + debt.title, reference_id: debt.id, scope: 'work' });
        settlement.transaction_id = journal.id;
        const updatedDebt = { ...debt, status: Math.abs(amount - remaining) <= Core.EPSILON ? 'settled' : 'partial', updated_at: now };
        await DB.commit({ debt_settlements: [settlement], debts: [updatedDebt], transactions: [journal] }, { action: 'settle', entity_type: 'debt', entity_id: debt.id, details: { amount } });
        toast('تم تسجيل التسوية والحركة النقدية');
        route('debts');
      } else if (type === 'category') {
        const category = { id: Core.uid('category'), name: value.name.trim(), type: value.type, scope: value.scope, system: false, created_at: now };
        await DB.commit({ categories: [category] }, { action: 'create', entity_type: 'category', entity_id: category.id, details: {} });
        toast('تم إنشاء التصنيف');
        route('budgets');
      } else if (type === 'budget') {
        const id = 'budget:' + value.month + ':' + value.category_id + ':' + value.currency + ':' + value.scope;
        const budget = { id, category_id: value.category_id, month: value.month, amount: Core.positiveAmount(value.amount), currency: value.currency, scope: value.scope, created_at: now, updated_at: now };
        await DB.commit({ budgets: [budget] }, { action: 'upsert', entity_type: 'budget', entity_id: id, details: {} });
        toast('تم حفظ الميزانية');
        route('budgets');
      } else if (type === 'rate') {
        if (value.from_currency === value.to_currency) throw new Error('اختر عملتين مختلفتين');
        const rate = { id: Core.uid('rate'), from_currency: value.from_currency, to_currency: value.to_currency, rate: Core.positiveAmount(value.rate, 'السعر'), date: value.date, created_at: now, source: 'manual' };
        await DB.commit({ exchange_rates: [rate] }, { action: 'create', entity_type: 'exchange_rate', entity_id: rate.id, details: {} });
        toast('تم حفظ سعر الصرف');
        route('exchange');
      } else if (type === 'task') {
        const task = { id: Core.uid('task'), title: value.title.trim(), scope: value.scope, due: value.due, notes: value.notes.trim(), done: false, created_at: now };
        await DB.commit({ tasks: [task] }, { action: 'create', entity_type: 'task', entity_id: task.id, details: {} });
        toast('تمت إضافة المهمة');
        route('tasks');
      } else if (type === 'followup') {
        const followup = { id: Core.uid('followup'), title: value.title.trim(), customer_id: value.customer_id, due: value.due, notes: value.notes.trim(), status: 'pending', created_at: now };
        await DB.commit({ followups: [followup] }, { action: 'create', entity_type: 'followup', entity_id: followup.id, details: {} });
        toast('تمت إضافة المتابعة');
        route('tasks');
      }
    } catch (error) {
      console.error(error);
      toast(error.message || 'تعذر الحفظ', true);
    }
  }

  async function toggleRecord(store, id, field, doneValue, openValue) {
    const record = byId(store, id);
    if (!record) return;
    const updated = { ...record, [field]: record[field] === doneValue ? openValue : doneValue, updated_at: new Date().toISOString() };
    await DB.commit({ [store]: [updated] }, { action: 'toggle', entity_type: store, entity_id: id, details: { field, value: updated[field] } });
    await refresh({ keepScroll: true });
  }

  async function voidTransaction(id) {
    const transaction = byId('transactions', id);
    if (!transaction || transaction.voided_at) return;
    if (!confirm('سيُنشأ قيد عكسي وتبقى الحركة الأصلية في السجل. متابعة؟')) return;
    const now = new Date().toISOString();
    const reversal = Core.reverseJournal(transaction, now);
    const updated = { ...transaction, voided_at: now, reversal_id: reversal.id, updated_at: now };
    await DB.commit({ transactions: [updated, reversal] }, { action: 'reverse', entity_type: 'transaction', entity_id: id, details: { reversal_id: reversal.id } });
    toast('تم عكس الحركة مع حفظ أثرها');
    route('journal');
  }

  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportBackup(silent) {
    const backup = await DB.exportBackup();
    downloadJSON(backup, 'hesabati-backup-' + Core.today() + '.json');
    if (!silent) toast('تم تصدير النسخة الاحتياطية');
  }

  async function restoreFile(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      Core.validateSnapshot(parsed, DB.EXPORT_STORES);
      if (!confirm('ستُستبدل البيانات الحالية بمحتوى النسخة. سيُنزل التطبيق نسخة أمان من بياناتك الحالية أولاً. متابعة؟')) return;
      await exportBackup(true);
      await DB.restoreBackup(parsed);
      state.integrity = null;
      await refresh();
      toast('تمت الاستعادة والترحيل بنجاح');
      route('home');
    } catch (error) {
      console.error(error);
      toast(error.message || 'ملف النسخة غير صالح', true);
    } finally {
      restoreInput.value = '';
    }
  }

  app.addEventListener('click', async event => {
    const routeButton = event.target.closest('[data-route]');
    if (routeButton && !routeButton.disabled) {
      event.preventDefault();
      route(routeButton.dataset.route);
      return;
    }
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;
    const action = actionButton.dataset.action;
    try {
      if (action === 'back') {
        if (history.length > 1) history.back();
        else route(actionButton.dataset.fallback || 'home');
      } else if (action === 'journal-filter') {
        state.journalFilter = actionButton.dataset.value;
        await refresh({ keepScroll: true });
      } else if (action === 'crm-tab') {
        state.crmTab = actionButton.dataset.value;
        await refresh({ keepScroll: true });
      } else if (action === 'report-mode') {
        state.reportMode = actionButton.dataset.value;
        await refresh({ keepScroll: true });
      } else if (action === 'report-scope') {
        state.reportScope = actionButton.dataset.value;
        await refresh({ keepScroll: true });
      } else if (action === 'toggle-task') {
        await toggleRecord('tasks', actionButton.dataset.id, 'done', true, false);
      } else if (action === 'toggle-followup') {
        await toggleRecord('followups', actionButton.dataset.id, 'status', 'done', 'pending');
      } else if (action === 'void-transaction') {
        await voidTransaction(actionButton.dataset.id);
      } else if (action === 'export') {
        await exportBackup(false);
      } else if (action === 'restore') {
        restoreInput.click();
      } else if (action === 'integrity') {
        state.integrity = Core.integrityReport(state.data);
        await refresh({ keepScroll: true });
        toast(state.integrity.ok ? 'فحص السلامة ناجح' : 'وجد الفحص مشكلات', !state.integrity.ok);
      }
    } catch (error) {
      console.error(error);
      toast(error.message || 'تعذر تنفيذ العملية', true);
    }
  });

  app.addEventListener('submit', event => {
    const form = event.target.closest('[data-form]');
    if (!form) return;
    event.preventDefault();
    submitForm(form);
  });

  app.addEventListener('change', async event => {
    const target = event.target;
    const action = target.dataset.change;
    if (action === 'report-anchor') {
      state.reportAnchor = target.value || Core.today();
      await refresh({ keepScroll: true });
    } else if (action === 'base-currency') {
      state.preference = await DB.setPreference({ base_currency: target.value });
      await refresh({ keepScroll: true });
      toast('تم تغيير عملة التقارير');
    } else if (action === 'default-scope') {
      state.preference = await DB.setPreference({ default_scope: target.value });
      toast('تم حفظ القسم الافتراضي');
    } else if (action === 'cost-paid') {
      const holder = document.getElementById('cost-account');
      if (holder) holder.classList.toggle('hidden', !target.checked);
    }
  });

  restoreInput.addEventListener('change', event => {
    const file = event.target.files && event.target.files[0];
    if (file) restoreFile(file);
  });

  window.addEventListener('hashchange', () => refresh());
  window.addEventListener('online', () => refresh({ keepScroll: true }));
  window.addEventListener('offline', () => refresh({ keepScroll: true }));
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    state.installPrompt = event;
  });

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !['https:', 'http:'].includes(location.protocol)) return;
    try {
      const registration = await navigator.serviceWorker.register('./sw.js');
      if (registration.waiting) document.getElementById('update-banner').classList.remove('hidden');
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) document.getElementById('update-banner').classList.remove('hidden');
        });
      });
      document.getElementById('apply-update').addEventListener('click', () => {
        if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        location.reload();
      });
    } catch (error) {
      console.warn('Service worker unavailable', error);
    }
  }

  (async function start() {
    try {
      const opened = await DB.open();
      state.migration = opened.migration;
      if (!location.hash) history.replaceState(null, '', '#home');
      await refresh();
      await registerServiceWorker();
      if (state.migration?.migrated) toast('تم ترحيل بيانات 0.2 مع نسخة أمان');
    } catch (error) {
      console.error(error);
      app.innerHTML = '<main class="page-wrap">' + appHeader('تعذر تشغيل حساباتي') + '<div class="notice danger">' + esc(error.message || 'تعذر فتح التخزين المحلي') + '</div><div class="notice info">افتح التطبيق من رابط HTTPS في Safari، وليس كملف محلي.</div></main>';
    }
  })();
})();
