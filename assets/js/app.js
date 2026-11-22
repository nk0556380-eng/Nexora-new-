/* Nexora application logic — onboarding, login, dashboard, invoice. No dependencies. */
(function () {
  'use strict';

  const page = document.body.dataset.page || '';
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const money = (n) => '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number(n) || 0);
  const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PAYMENT_LABELS = { bank_transfer: 'Bank transfer', upi: 'UPI', card: 'Card', cash: 'Cash', cheque: 'Cheque', other: 'Other' };

  function fmtDate(value, withTime) {
    if (!value) return '—';
    const parts = String(value).split(' ');
    const date = new Date(parts[0] + 'T00:00:00');
    if (isNaN(date)) return String(value);
    const d = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    if (!withTime || !parts[1]) return d;
    return d + ', ' + parts[1].slice(0, 5);
  }
  const localDate = (date) => date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  const today = () => localDate(new Date());
  function inDays(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return localDate(d);
  }

  function newInvoiceRequestKey() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'inv-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  async function api(path, options) {
    const opts = options || {};
    const response = await fetch(path, {
      method: opts.method || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    let data = {};
    try { data = await response.json(); } catch (_) { /* empty response */ }
    if (response.status === 401 && (page === 'dashboard' || page === 'invoice')) {
      window.location.href = '/login.html';
      throw new Error('Session expired.');
    }
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  let toastTimer;
  function toast(message, isError) {
    const el = $('#toast');
    if (!el) return;
    el.setAttribute('role', isError ? 'alert' : 'status');
    el.setAttribute('aria-live', isError ? 'assertive' : 'polite');
    el.classList.toggle('is-error', Boolean(isError));
    el.hidden = false;
    el.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
  }

  let generatedId = 0;
  function errorId(field) {
    if (!field.id) field.id = 'field-' + (++generatedId);
    return field.id + '-error';
  }

  function setError(field, message) {
    const id = errorId(field);
    const old = document.getElementById(id);
    if (old) old.remove();
    field.setAttribute('aria-invalid', String(Boolean(message)));
    const described = (field.getAttribute('aria-describedby') || '')
      .split(/\s+/)
      .filter((value) => value && value !== id);
    if (message) {
      const span = document.createElement('span');
      span.className = 'field-error';
      span.id = id;
      span.textContent = message;
      field.insertAdjacentElement('afterend', span);
      described.push(id);
    }
    if (described.length) field.setAttribute('aria-describedby', described.join(' '));
    else field.removeAttribute('aria-describedby');
  }

  function validateFields(fields) {
    let firstBad = null;
    fields.forEach((field) => {
      const value = String(field.value || '').trim();
      let message = '';
      if (field.required && !value) message = 'Please fill this in.';
      else if (field.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) message = 'Enter a valid email.';
      else if (field.type === 'url' && value && !/^https?:\/\//i.test(value)) message = 'Start with http:// or https://';
      setError(field, message);
      if (message && !firstBad) firstBad = field;
    });
    return firstBad;
  }

  /* =============================== LOGIN =============================== */
  if (page === 'login') {
    const form = $('#login-form');
    const password = $('#l-password');
    const toggle = $('#toggle-password');
    const error = $('#login-error');
    const button = $('#login-submit');

    if (toggle && password) {
      toggle.addEventListener('click', () => {
        const show = password.type === 'password';
        password.type = show ? 'text' : 'password';
        toggle.textContent = show ? 'Hide' : 'Show';
        toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        toggle.setAttribute('aria-pressed', String(show));
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.textContent = '';
      if (!password.value.trim()) {
        setError(password, 'Enter your password.');
        password.focus();
        return;
      }
      setError(password, '');
      button.disabled = true;
      try {
        await api('/api/login', { method: 'POST', body: { password: password.value } });
        window.location.href = '/dashboard';
      } catch (err) {
        error.textContent = err.message || 'Could not sign in.';
        button.disabled = false;
        password.focus();
      }
    });
    password.addEventListener('input', () => {
      if (password.getAttribute('aria-invalid') === 'true') setError(password, '');
    });
  }

  /* ============================= ONBOARDING ============================ */
  if (page === 'onboarding') {
    const form = $('#onboarding-form');
    const status = $('#onboard-status');
    const consent = $('#o-consent');
    const consentError = $('#consent-error');
    const button = $('#onboard-submit');
    const fields = $$('input, textarea, select', form).filter((el) => el !== consent);

    function announce(message, isError) {
      status.setAttribute('aria-live', isError ? 'assertive' : 'polite');
      status.classList.toggle('is-error', Boolean(isError));
      status.textContent = message;
    }

    function clearConsentError() {
      consent.setAttribute('aria-invalid', 'false');
      consent.removeAttribute('aria-describedby');
      consentError.hidden = true;
      consentError.textContent = '';
    }

    function showConsentError(message) {
      consent.setAttribute('aria-invalid', 'true');
      consent.setAttribute('aria-describedby', consentError.id);
      consentError.textContent = message;
      consentError.hidden = false;
    }

    fields.forEach((field) => field.addEventListener('input', () => {
      if (field.getAttribute('aria-invalid') === 'true') setError(field, '');
    }));
    consent.addEventListener('change', () => { if (consent.checked) clearConsentError(); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const bad = validateFields(fields);
      if (!consent.checked) {
        showConsentError('Please confirm you are authorised to share these details.');
        announce('Check the highlighted fields.', true);
        consent.focus();
        return;
      }
      clearConsentError();
      if (bad) {
        announce('Check the highlighted fields.', true);
        bad.focus();
        return;
      }

      const payload = { consent: true };
      fields.forEach((field) => { payload[field.name] = field.value.trim(); });

      button.disabled = true;
      announce('Submitting…', false);
      form.setAttribute('aria-busy', 'true');
      try {
        const result = await api('/api/onboarding', { method: 'POST', body: payload });
        form.parentNode.innerHTML =
          '<div class="success-card">' +
          '<div class="success-icon" aria-hidden="true">✓</div>' +
          '<h2 id="onboard-success" tabindex="-1">Onboarding received.</h2>' +
          '<p>Thanks — we will review the details and get back to you with a clear yes or no.</p>' +
          '<span class="ref">REF · CL-' + String(result.id).padStart(4, '0') + '</span>' +
          '<div><a class="btn btn-secondary" href="/">Back to site</a></div>' +
          '</div>';
        $('#onboard-success').focus();
      } catch (err) {
        form.removeAttribute('aria-busy');
        announce(err.message || 'Could not submit. Please try again.', true);
        button.disabled = false;
      }
    });
  }

  /* ============================= DASHBOARD ============================= */
  if (page === 'dashboard') {
    const titles = {
      overview: ['Overview', 'Everything happening in your workspace.'],
      orders: ['Orders', 'Review requests and decide what to take on.'],
      onboarding: ['Onboarding', 'Submitted agency details awaiting approval.'],
      invoices: ['Invoices', 'Create, send and track payments.'],
      logins: ['Client logins', 'Issue and manage client portal access.']
    };
    let state = { orders: [], clients: [], invoices: [], accounts: [], stats: null, orderFilter: 'all' };
    const sidebar = $('#sidebar');
    const menuBtn = $('#menu-btn');
    const mobileShell = window.matchMedia('(max-width: 860px)');

    function focusViewHeading() {
      const heading = $('#page-title');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus();
      }
    }

    function syncSidebar() {
      if (!mobileShell.matches) {
        sidebar.classList.remove('is-open');
        sidebar.inert = false;
        menuBtn.setAttribute('aria-expanded', 'false');
        return;
      }
      const open = sidebar.classList.contains('is-open');
      sidebar.inert = !open;
      menuBtn.setAttribute('aria-expanded', String(open));
    }

    function setSidebar(open, restoreFocus) {
      if (!mobileShell.matches) return;
      sidebar.classList.toggle('is-open', open);
      sidebar.inert = !open;
      menuBtn.setAttribute('aria-expanded', String(open));
      menuBtn.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
      if (open) {
        const first = $('.side-link', sidebar);
        if (first) first.focus();
      } else if (restoreFocus) {
        menuBtn.focus();
      }
    }

    function switchView(name) {
      if (!titles[name]) return;
      $$('.view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === name));
      $$('.side-link').forEach((b) => {
        const active = b.dataset.view === name;
        b.classList.toggle('is-active', active);
        if (active) b.setAttribute('aria-current', 'page');
        else b.removeAttribute('aria-current');
      });
      $('#page-title').textContent = titles[name][0];
      $('#page-sub').textContent = titles[name][1];
      setSidebar(false, false);
    }

    function pill(status) {
      return '<span class="status-pill status-' + esc(status) + '">' + esc(cap(status)) + '</span>';
    }
    function demo(row) { return row.is_sample ? '<span class="demo-tag">DEMO</span>' : ''; }

    function orderRow(o) {
      let actions = '';
      if (o.status === 'new') {
        actions = '<button class="mini-btn accent" data-act="accept" data-id="' + o.id + '" aria-label="Accept request ' + esc(o.ref) + '">Accept</button>' +
          '<button class="mini-btn" data-act="reject" data-id="' + o.id + '" aria-label="Reject request ' + esc(o.ref) + '">Reject</button>';
      } else if (o.status === 'accepted') {
        actions = '<button class="mini-btn" data-act="invoice" data-id="' + o.id + '" aria-label="Create invoice for ' + esc(o.agency) + '">Invoice</button>';
      } else {
        actions = '<span class="cell-sub">—</span>';
      }
      return '<tr>' +
        '<td><b>' + esc(o.ref) + '</b>' + demo(o) + '</td>' +
        '<td><span class="cell-main">' + esc(o.agency) + '</span><span class="cell-sub">' + esc(o.name) + '</span></td>' +
        '<td>' + esc(o.service || '—') + '</td>' +
        '<td>' + pill(o.status) + '</td>' +
        '<td>' + esc(fmtDate(o.created_at, true)) + '</td>' +
        '<td><div class="row-actions">' + actions + '</div></td>' +
        '</tr>';
    }

    function clientRow(c) {
      return '<tr>' +
        '<td><span class="cell-main">' + esc(c.agency) + '</span><span class="cell-sub">' + esc(c.website || '') + '</span>' + demo(c) + '</td>' +
        '<td>' + esc(c.contact_name) + '<span class="cell-sub">' + esc(c.email) + '</span></td>' +
        '<td>' + esc(c.city || '—') + '</td>' +
        '<td>' + pill(c.status) + '</td>' +
        '<td>' + esc(fmtDate(c.created_at, true)) + '</td>' +
        '<td><div class="row-actions"><button class="mini-btn accent" data-act="review" data-id="' + c.id + '" aria-label="Review onboarding for ' + esc(c.agency) + '">Review</button></div></td>' +
        '</tr>';
    }

    function invoiceRow(inv) {
      let actions = '<a class="mini-btn" href="/invoice/' + inv.id + '">View<span class="visually-hidden"> invoice ' + esc(inv.number) + '</span></a>';
      if (inv.status === 'draft') {
        actions += '<button class="mini-btn accent" data-act="send" data-id="' + inv.id + '" aria-label="Mark invoice ' + esc(inv.number) + ' as sent">Send</button>';
      }
      if (inv.status === 'sent') {
        actions += '<button class="mini-btn accent" data-act="paid" data-id="' + inv.id + '" aria-label="Mark invoice ' + esc(inv.number) + ' as paid">Mark paid</button>';
      }
      if (inv.status === 'draft' || inv.status === 'sent') {
        actions += '<button class="mini-btn" data-act="cancel" data-id="' + inv.id + '" aria-label="Cancel invoice ' + esc(inv.number) + '">Cancel</button>';
      }
      return '<tr>' +
        '<td><b>' + esc(inv.number) + '</b>' + demo(inv) + '</td>' +
        '<td>' + esc(inv.client_name) + '<span class="cell-sub">' + esc(inv.client_email || '') + '</span></td>' +
        '<td>' + esc(fmtDate(inv.issue_date)) + '</td>' +
        '<td>' + esc(fmtDate(inv.due_date)) + '</td>' +
        '<td><b>' + money(inv.total) + '</b></td>' +
        '<td>' + pill(inv.status) + '</td>' +
        '<td><div class="row-actions">' + actions + '</div></td>' +
        '</tr>';
    }

    function loginRow(account) {
      const enabled = account.status === 'active';
      const actions = '<button class="mini-btn" data-act="regenerate" data-id="' + account.id +
        '" aria-label="Generate a new code for ' + esc(account.agency) + '">New code</button>' +
        '<button class="mini-btn" data-act="toggle-login" data-id="' + account.id + '" data-status="' +
        (enabled ? 'disabled' : 'active') + '" aria-label="' + (enabled ? 'Disable' : 'Enable') +
        ' login for ' + esc(account.agency) + '">' + (enabled ? 'Disable' : 'Enable') + '</button>';
      return '<tr>' +
        '<td><span class="cell-main">' + esc(account.agency) + '</span></td>' +
        '<td>' + esc(account.contact_name) + '<span class="cell-sub">' + esc(account.email || '') + '</span></td>' +
        '<td>' + esc(account.phone) + '</td>' +
        '<td>' + pill(account.onboarding_status || 'not_submitted') + '</td>' +
        '<td>' + pill(enabled ? 'active' : 'disabled') + '</td>' +
        '<td><div class="row-actions">' + actions + '</div></td>' +
        '</tr>';
    }

    function render() {
      const active = document.activeElement;
      const activeAction = active && active.closest && active.closest('tbody') && active.dataset.act
        ? { act: active.dataset.act, id: active.dataset.id }
        : null;
      const orders = state.orders;
      const filtered = state.orderFilter === 'all' ? orders : orders.filter((o) => o.status === state.orderFilter);
      const empty = (cols, text) => '<tr class="empty-row"><td colspan="' + cols + '">' + text + '</td></tr>';

      $('#orders-body').innerHTML = filtered.length ? filtered.map(orderRow).join('') : empty(7, 'No orders in this view yet.');
      $('#recent-orders-body').innerHTML = orders.length ? orders.slice(0, 4).map(orderRow).join('') : empty(6, 'No requests yet.');
      $('#onboarding-body').innerHTML = state.clients.length ? state.clients.map(clientRow).join('') : empty(6, 'No onboarding submissions yet.');
      $('#invoices-body').innerHTML = state.invoices.length ? state.invoices.map(invoiceRow).join('') : empty(7, 'No invoices yet. Create one to get started.');
      $('#logins-body').innerHTML = state.accounts.length ? state.accounts.map(loginRow).join('') : empty(6, 'No client logins yet. Create one to give a client portal access.');

      const s = state.stats || {};
      $('#kpi-new').textContent = (s.orders && s.orders.new) || 0;
      $('#kpi-accepted').textContent = (s.orders && s.orders.accepted) || 0;
      $('#kpi-pending').textContent = (s.onboarding && s.onboarding.pending) || 0;
      $('#kpi-billed').textContent = money(s.billed || 0);
      $('#side-orders').textContent = orders.length;
      $('#side-onboarding').textContent = state.clients.length;
      $('#side-invoices').textContent = state.invoices.length;
      $('#side-logins').textContent = state.accounts.length;

      if (activeAction) {
        const same = $('[data-act="' + activeAction.act + '"][data-id="' + activeAction.id + '"]');
        if (same) same.focus();
        else focusViewHeading();
      }
    }

    async function load() {
      const views = $('.views');
      if (views) views.setAttribute('aria-busy', 'true');
      try {
        const [stats, orders, clients, invoices, accounts] = await Promise.all([
          api('/api/stats'), api('/api/orders'), api('/api/onboarding'), api('/api/invoices'),
          api('/api/client-accounts')
        ]);
        state = { stats, orders, clients, invoices, accounts, orderFilter: state.orderFilter };
        render();
      } catch (err) {
        toast(err.message || 'Could not load data.', true);
      } finally {
        if (views) views.removeAttribute('aria-busy');
      }
    }

    /* Modal helpers */
    const backdrop = $('#modal-backdrop');
    const modal = $('#modal');
    const shell = $('.app-shell');
    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    let lastFocused = null;

    function openModal(title, html) {
      lastFocused = document.activeElement;
      $('#modal-title').textContent = title;
      $('#modal-body').innerHTML = html;
      backdrop.hidden = false;
      if (shell) shell.inert = true;
      const target = $('#modal-body').querySelector('input, select, textarea, button, a[href]') || $('#modal-close');
      target.focus();
    }
    function closeModal() {
      if (backdrop.hidden) return;
      backdrop.hidden = true;
      $('#modal-body').innerHTML = '';
      if (shell) shell.inert = false;
      if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
      lastFocused = null;
    }

    $('#modal-close').addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
    document.addEventListener('keydown', (e) => {
      if (backdrop.hidden) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = $$(FOCUSABLE, modal).filter((el) => el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    function detail(label, value, wide) {
      return '<div class="detail' + (wide ? ' detail-wide' : '') + '"><span>' + esc(label) + '</span><b>' + esc(value || '—') + '</b></div>';
    }

    async function reviewClient(id) {
      const c = state.clients.find((x) => String(x.id) === String(id));
      if (!c) return;
      const html = '<div class="detail-grid">' +
        detail('Agency', c.agency) + detail('Contact', c.contact_name) +
        detail('Email', c.email) + detail('Phone', c.phone) +
        detail('Website', c.website) + detail('City', c.city) +
        detail('Services', c.services, true) + detail('Ideal customer', c.target_profile, true) +
        detail('List source', c.list_source) + detail('Monthly volume', c.monthly_volume) +
        detail('Notes', c.notes, true) +
        '</div>' +
        '<div class="modal-actions">' +
        '<button class="btn btn-primary" data-approve="' + c.id + '" data-status="approved">Approve client</button>' +
        '<button class="btn btn-danger" data-approve="' + c.id + '" data-status="rejected">Reject</button>' +
        '</div>';
      openModal('Review onboarding · ' + c.agency, html);
      $$('[data-approve]', $('#modal-body')).forEach((btn) => btn.addEventListener('click', async () => {
        try {
          await api('/api/onboarding/' + btn.dataset.approve, { method: 'PATCH', body: { status: btn.dataset.status } });
          closeModal();
          await load();
          toast('Onboarding ' + btn.dataset.status + '.');
        } catch (err) { toast(err.message, true); }
      }));
    }

    function invoiceModal(order) {
      const o = order || null;
      const requestKey = newInvoiceRequestKey();
      const html = '<form id="invoice-form" novalidate>' +
        '<div class="form-grid">' +
        '<div class="field"><label for="i-client">Client <b aria-hidden="true">*</b></label><input id="i-client" name="client_name" type="text" value="' + esc(o ? o.agency : '') + '" placeholder="Agency name" required></div>' +
        '<div class="field"><label for="i-email">Billing email</label><input id="i-email" name="client_email" type="email" autocomplete="email" value="' + esc(o ? o.email : '') + '" placeholder="billing@agency.com"></div>' +
        '<div class="field"><label for="i-issue">Issue date <b aria-hidden="true">*</b></label><input id="i-issue" name="issue_date" type="date" value="' + today() + '" required></div>' +
        '<div class="field"><label for="i-due">Due date <b aria-hidden="true">*</b></label><input id="i-due" name="due_date" type="date" value="' + inDays(14) + '" required></div>' +
        '<div class="field"><label for="i-tax">Tax %</label><input id="i-tax" name="tax_percent" type="number" min="0" max="100" step="0.01" value="18"></div>' +
        '<div class="field"><label for="i-discount">Discount %</label><input id="i-discount" name="discount_percent" type="number" min="0" max="100" step="0.01" value="0"></div>' +
        '<div class="field"><label for="i-notes">Notes</label><input id="i-notes" name="notes" type="text" placeholder="Optional payment note"></div>' +
        '</div>' +
        '<div class="form-block-head modal-section-head"><div><h2>Line items</h2><p>Add the work being billed.</p></div></div>' +
        '<div id="line-items"></div>' +
        '<button type="button" class="mini-btn" id="add-item">+ Add line item</button>' +
        '<div class="modal-total" id="invoice-total" aria-live="polite">Total · ₹0</div>' +
        '<p class="form-status is-error" id="invoice-form-status" role="alert"></p>' +
        '<div class="modal-actions"><button class="btn btn-primary" type="submit">Create invoice <span aria-hidden="true">↗</span></button></div>' +
        '</form>';

      openModal('New invoice', html);
      const body = $('#modal-body');
      const holder = $('#line-items', body);
      const totalEl = $('#invoice-total', body);
      const formStatus = $('#invoice-form-status', body);
      let lineSeq = 0;

      function addItem(description) {
        const row = document.createElement('div');
        row.className = 'line-item';
        const rowId = 'li-' + (++lineSeq);
        row.innerHTML = '<div class="field"><label for="' + rowId + '-desc">Description</label><input id="' + rowId + '-desc" class="li-desc" type="text" placeholder="What was delivered" value="' + esc(description || '') + '"></div>' +
          '<div class="field"><label for="' + rowId + '-qty">Qty</label><input id="' + rowId + '-qty" class="li-qty" type="number" min="0.001" step="0.001" value="1"></div>' +
          '<div class="field"><label for="' + rowId + '-rate">Rate ₹</label><input id="' + rowId + '-rate" class="li-rate" type="number" min="1" step="1" value="0"></div>' +
          '<button type="button" class="remove-item" aria-label="Remove line item">×</button>';
        holder.appendChild(row);
        $('.remove-item', row).addEventListener('click', () => {
          row.remove();
          refreshRemoveLabels();
          updateTotal();
        });
        $$('input', row).forEach((input) => input.addEventListener('input', () => {
          if (input.getAttribute('aria-invalid') === 'true') setError(input, '');
          updateTotal();
        }));
        refreshRemoveLabels();
      }

      function refreshRemoveLabels() {
        $$('.remove-item', holder).forEach((btn, index) => {
          btn.setAttribute('aria-label', 'Remove line item ' + (index + 1));
        });
      }

      function draftItems() {
        return $$('.line-item', holder).map((row) => ({
          description: $('.li-desc', row).value.trim(),
          qty: Number($('.li-qty', row).value),
          rate: Number($('.li-rate', row).value)
        })).filter((item) => item.description || item.rate > 0);
      }

      function validateItems() {
        let firstBad = null;
        let used = false;
        $$('.line-item', holder).forEach((row) => {
          const desc = $('.li-desc', row);
          const qty = $('.li-qty', row);
          const rate = $('.li-rate', row);
          setError(desc, '');
          setError(qty, '');
          setError(rate, '');
          const hasInput = Boolean(desc.value.trim() || Number(qty.value) > 0 || Number(rate.value) > 0);
          if (!hasInput) return;
          used = true;
          if (!desc.value.trim()) {
            setError(desc, 'Describe the work.');
            if (!firstBad) firstBad = desc;
          }
          const quantity = Number(qty.value);
          if (!Number.isFinite(quantity) || quantity <= 0) {
            setError(qty, 'Enter a quantity above 0.');
            if (!firstBad) firstBad = qty;
          }
          const amount = Number(rate.value);
          if (!Number.isInteger(amount) || amount < 1) {
            setError(rate, 'Enter a whole rupee rate of at least 1.');
            if (!firstBad) firstBad = rate;
          }
        });
        if (!used) {
          const desc = $('.li-desc', holder);
          if (desc) {
            setError(desc, 'Add at least one line item with a description and rate.');
            firstBad = desc;
          }
        }
        return firstBad;
      }

      function updateTotal() {
        const items = draftItems();
        if (!items.length) {
          totalEl.textContent = 'Total · ₹0';
          return;
        }
        try {
          const totals = window.NexoraMoney.compute({
            items,
            tax_percent: Number($('#i-tax', body).value) || 0,
            discount_percent: Number($('#i-discount', body).value) || 0
          });
          totalEl.textContent = 'Total · ' + money(totals.total);
        } catch (_) {
          totalEl.textContent = 'Total · —';
        }
      }

      $('#add-item', body).addEventListener('click', () => addItem());
      $('#i-tax', body).addEventListener('input', updateTotal);
      $('#i-discount', body).addEventListener('input', updateTotal);
      addItem(o ? (o.service ? o.service + ' — engagement' : 'Engagement') : '');
      updateTotal();

      $('#invoice-form', body).addEventListener('submit', async (e) => {
        e.preventDefault();
        formStatus.textContent = '';
        const form = e.target;
        const fields = $$('input[required]', form);
        const bad = validateFields(fields);
        if (bad) { bad.focus(); return; }

        const badItem = validateItems();
        if (badItem) {
          formStatus.textContent = 'Check the highlighted line items.';
          badItem.focus();
          return;
        }

        const items = draftItems();
        if (!items.length) {
          formStatus.textContent = 'Add at least one line item with a description and rate.';
          return;
        }

        let totals;
        try {
          totals = window.NexoraMoney.compute({
            items,
            tax_percent: Number(form.tax_percent.value) || 0,
            discount_percent: Number(form.discount_percent.value) || 0
          });
        } catch (err) {
          toast(err.message || 'Check the line items.', true);
          return;
        }

        const payload = {
          client_name: form.client_name.value.trim(),
          client_email: form.client_email.value.trim(),
          issue_date: form.issue_date.value,
          due_date: form.due_date.value,
          tax_percent: totals.tax_percent,
          discount_percent: totals.discount_percent,
          notes: form.notes.value.trim(),
          items: totals.items.map((item) => ({
            description: item.description,
            qty: item.qty,
            rate: item.rate
          }))
        };
        if (o) payload.order_id = o.id;

        const submit = $('button[type="submit"]', form);
        submit.disabled = true;
        try {
          const created = await api('/api/invoices', {
            method: 'POST',
            body: payload,
            headers: { 'Idempotency-Key': requestKey }
          });
          closeModal();
          switchView('invoices');
          await load();
          const createdLink = $('#invoices-body a[href="/invoice/' + created.id + '"]');
          if (createdLink) createdLink.focus();
          toast('Invoice ' + created.number + ' created.');
        } catch (err) { toast(err.message, true); submit.disabled = false; }
      });
    }

    function paymentModal(invoice) {
      const options = Object.keys(PAYMENT_LABELS)
        .map((value) => '<option value="' + value + '">' + PAYMENT_LABELS[value] + '</option>')
        .join('');
      const html = '<form id="payment-form" novalidate>' +
        '<div class="detail-grid">' +
        detail('Invoice', invoice.number) + detail('Client', invoice.client_name) +
        detail('Invoice total', money(invoice.total)) +
        '</div>' +
        '<div class="form-grid">' +
        '<div class="field"><label for="p-amount">Amount received (₹) <b aria-hidden="true">*</b></label><input id="p-amount" name="amount" type="number" min="1" step="1" value="' + invoice.total + '" required></div>' +
        '<div class="field"><label for="p-method">Payment method <b aria-hidden="true">*</b></label><select id="p-method" name="method">' + options + '</select></div>' +
        '</div>' +
        '<p class="modal-note">One full payment is recorded. Partial payments are not supported.</p>' +
        '<div class="modal-actions"><button class="btn btn-primary" type="submit">Record payment</button></div>' +
        '</form>';

      openModal('Record payment · ' + invoice.number, html);
      const form = $('#payment-form', $('#modal-body'));

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        setError(form.amount, '');
        const amount = Number(form.amount.value);
        if (!Number.isInteger(amount) || amount < 1) {
          setError(form.amount, 'Enter a whole rupee amount of at least ₹1.');
          form.amount.focus();
          return;
        }
        if (amount !== invoice.total) {
          setError(form.amount, 'Amount must equal the invoice total of ' + money(invoice.total) + '.');
          form.amount.focus();
          return;
        }

        const submit = $('button[type="submit"]', form);
        submit.disabled = true;
        try {
          await api('/api/invoices/' + invoice.id, {
            method: 'PATCH',
            body: { status: 'paid', payment: { amount, method: form.method.value } }
          });
          closeModal();
          await load();
          toast('Payment recorded for ' + invoice.number + '.');
        } catch (err) {
          toast(err.message || 'Could not record payment.', true);
          submit.disabled = false;
        }
      });
    }

    function showCodeModal(code, agency) {
      const html = '<div class="code-reveal">' +
        '<p>Share this code with <b>' + esc(agency) + '</b>. It is shown once — store it safely.</p>' +
        '<code class="share-code" id="share-code">' + esc(code) + '</code>' +
        '<button type="button" class="mini-btn" id="copy-code">Copy code</button>' +
        '</div><div class="modal-actions"><button type="button" class="btn btn-primary" id="code-done">Done</button></div>';
      openModal('Client access code', html);
      $('#copy-code', $('#modal-body')).addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(code);
          toast('Access code copied.');
        } catch (_) {
          toast('Select the code above to copy it.', true);
        }
      });
      $('#code-done', $('#modal-body')).addEventListener('click', closeModal);
    }

    function loginModal() {
      const options = '<option value="">— Enter details manually —</option>' +
        state.clients.filter((client) => client.status !== 'rejected').map((client) =>
          '<option value="' + client.id + '" data-agency="' + esc(client.agency) +
          '" data-contact="' + esc(client.contact_name) + '" data-phone="' + esc(client.phone) +
          '" data-email="' + esc(client.email) + '">' + esc(client.agency) + ' · ' + esc(client.contact_name) + '</option>'
        ).join('');

      const html = '<form id="login-form" novalidate>' +
        '<div class="field"><label for="a-source">Onboarding record</label><select id="a-source">' + options + '</select></div>' +
        '<div class="form-grid">' +
        '<div class="field"><label for="a-agency">Agency <b aria-hidden="true">*</b></label><input id="a-agency" name="agency" type="text" required></div>' +
        '<div class="field"><label for="a-contact">Contact name <b aria-hidden="true">*</b></label><input id="a-contact" name="contact_name" type="text" required></div>' +
        '<div class="field"><label for="a-phone">Phone number <b aria-hidden="true">*</b></label><input id="a-phone" name="phone" type="tel" required></div>' +
        '<div class="field"><label for="a-email">Billing email</label><input id="a-email" name="email" type="email"></div>' +
        '<div class="field field-full"><label for="a-code">Access code</label><input id="a-code" name="code" type="text" placeholder="Leave blank to generate one" spellcheck="false"></div>' +
        '</div>' +
        '<p class="modal-note">The client signs in with this phone number and the code you share. Codes are stored as salted hashes.</p>' +
        '<p class="form-status is-error" id="login-form-status" role="alert"></p>' +
        '<div class="modal-actions"><button class="btn btn-primary" type="submit">Create login <span aria-hidden="true">↗</span></button></div>' +
        '</form>';

      openModal('Create client login', html);
      const body = $('#modal-body');
      const form = $('#login-form', body);
      const source = $('#a-source', body);

      source.addEventListener('change', () => {
        const selected = source.selectedOptions[0];
        if (!selected || !selected.dataset.agency) return;
        $('#a-agency', form).value = selected.dataset.agency;
        $('#a-contact', form).value = selected.dataset.contact;
        $('#a-phone', form).value = selected.dataset.phone;
        $('#a-email', form).value = selected.dataset.email;
      });

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const status = $('#login-form-status', form);
        status.textContent = '';
        const bad = validateFields($$('input[required]', form));
        if (bad) { bad.focus(); return; }

        const payload = {
          agency: form.agency.value.trim(),
          contact_name: form.contact_name.value.trim(),
          phone: form.phone.value.trim(),
          email: form.email.value.trim(),
          code: form.code.value.trim()
        };
        if (source.value) payload.client_id = Number(source.value);

        const submit = $('button[type="submit"]', form);
        submit.disabled = true;
        try {
          const result = await api('/api/client-accounts', { method: 'POST', body: payload });
          closeModal();
          await load();
          showCodeModal(result.code, result.account.agency);
        } catch (err) {
          status.textContent = err.message || 'Could not create the login.';
          submit.disabled = false;
        }
      });
    }

    /* Events */
    $$('.side-link').forEach((btn) => btn.addEventListener('click', () => {
      switchView(btn.dataset.view);
      if (mobileShell.matches) menuBtn.focus();
    }));
    $$('[data-jump]').forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.jump)));
    menuBtn.addEventListener('click', () => setSidebar(!sidebar.classList.contains('is-open'), true));
    mobileShell.addEventListener('change', syncSidebar);
    syncSidebar();

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && backdrop.hidden && sidebar.classList.contains('is-open')) {
        setSidebar(false, true);
      }
    });
    document.addEventListener('click', (e) => {
      if (!sidebar.classList.contains('is-open')) return;
      if (!sidebar.contains(e.target) && !menuBtn.contains(e.target)) setSidebar(false, false);
    });

    $$('#order-filters button').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.classList.contains('is-active')));
      btn.addEventListener('click', () => {
        state.orderFilter = btn.dataset.filter;
        $$('#order-filters button').forEach((b) => {
          const active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-pressed', String(active));
        });
        render();
      });
    });

    function openNewInvoice() { invoiceModal(null); }
    $('#new-invoice-btn').addEventListener('click', openNewInvoice);
    $('#new-invoice-btn-2').addEventListener('click', openNewInvoice);
    $('#quick-invoice').addEventListener('click', openNewInvoice);
    $('#new-login-btn').addEventListener('click', loginModal);

    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const id = btn.dataset.id;
      const action = btn.dataset.act;
      try {
        if (action === 'accept' || action === 'reject') {
          await api('/api/orders/' + id, { method: 'PATCH', body: { status: action === 'accept' ? 'accepted' : 'rejected' } });
          await load();
          toast('Order ' + (action === 'accept' ? 'accepted' : 'rejected') + '.');
        } else if (action === 'invoice') {
          invoiceModal(state.orders.find((o) => String(o.id) === String(id)));
        } else if (action === 'review') {
          reviewClient(id);
        } else if (action === 'paid') {
          const invoice = state.invoices.find((row) => String(row.id) === String(id));
          if (invoice) paymentModal(invoice);
        } else if (action === 'send') {
          await api('/api/invoices/' + id, { method: 'PATCH', body: { status: 'sent' } });
          await load();
          toast('Invoice marked as sent.');
        } else if (action === 'cancel') {
          if (!window.confirm('Cancel this invoice? This cannot be undone.')) return;
          await api('/api/invoices/' + id, { method: 'PATCH', body: { status: 'cancelled' } });
          await load();
          toast('Invoice cancelled.');
        } else if (action === 'regenerate') {
          const result = await api('/api/client-accounts/' + id + '/regenerate', { method: 'POST' });
          const account = state.accounts.find((row) => String(row.id) === String(id));
          await load();
          showCodeModal(result.code, account ? account.agency : 'this client');
        } else if (action === 'toggle-login') {
          await api('/api/client-accounts/' + id, { method: 'PATCH', body: { status: btn.dataset.status } });
          await load();
          toast('Client login ' + (btn.dataset.status === 'active' ? 'enabled.' : 'disabled.'));
        }
      } catch (err) { toast(err.message || 'Could not update.', true); }
    });

    $('#logout-btn').addEventListener('click', async () => {
      try { await api('/api/logout', { method: 'POST' }); } catch (_) { /* ignore */ }
      window.location.href = '/login.html';
    });

    load();
  }

  /* ============================== INVOICE ============================== */
  if (page === 'invoice') {
    const match = window.location.pathname.match(/\/invoice\/(\d+)/);
    const id = match ? match[1] : null;

    if (!id) {
      $('#invoice-sheet').innerHTML = '<div class="invoice-loading">Invalid invoice link.</div>';
      $('#invoice-sheet').setAttribute('aria-busy', 'false');
    } else {
      api('/api/invoices/' + id).then((inv) => {
        $('#invoice-status').textContent = cap(inv.status);
        $('#invoice-status').className = 'status-pill status-' + esc(inv.status);
        const rows = inv.items.map((item) =>
          '<tr><td>' + esc(item.description) + '</td><td class="num">' + esc(Number(item.qty)) + '</td><td class="num">' + money(item.rate) + '</td><td class="num">' + money(item.amount) + '</td></tr>'
        ).join('');
        const discountAmount = Number(inv.discount_amount) || 0;
        const discountRow = discountAmount > 0
          ? '<div><span>Discount (' + esc(inv.discount_percent) + '%)</span><span>−' + money(discountAmount) + '</span></div>'
          : '';
        const payment = inv.payment;
        const paymentLine = payment
          ? '<br>Paid: ' + esc(fmtDate(payment.paid_at, true)) + ' · ' + esc(PAYMENT_LABELS[payment.method] || payment.method)
          : '';

        $('#invoice-sheet').innerHTML =
          '<div class="inv-top"><div class="inv-brand"><img class="inv-mark" src="/assets/brand/nexora-mark.svg" alt=""><span>Nexora<span class="dot">.</span></span></div>' +
          '<div class="inv-title"><h1>INVOICE</h1><span>' + esc(inv.number) + '</span></div></div>' +
          '<div class="inv-meta">' +
          '<div class="inv-block"><h2>Billed to</h2><p><b>' + esc(inv.client_name) + '</b>' + esc(inv.client_email || '') + '</p></div>' +
          '<div class="inv-block"><h2>Details</h2><p>Issued: ' + esc(fmtDate(inv.issue_date)) + '<br>Due: ' + esc(fmtDate(inv.due_date)) + '<br>Status: ' + esc(cap(inv.status)) + paymentLine + '</p></div>' +
          '</div>' +
          '<table class="inv-table"><caption class="visually-hidden">Invoice line items</caption><thead><tr><th scope="col">Description</th><th scope="col" class="num">Qty</th><th scope="col" class="num">Rate</th><th scope="col" class="num">Amount</th></tr></thead><tbody>' + rows + '</tbody></table>' +
          '<div class="inv-totals"><div><span>Subtotal</span><span>' + money(inv.subtotal) + '</span></div>' +
          discountRow +
          '<div><span>Tax (' + esc(inv.tax_percent) + '%)</span><span>' + money(inv.tax_amount) + '</span></div>' +
          '<div class="grand"><span>Total</span><span>' + money(inv.total) + '</span></div></div>' +
          (inv.notes ? '<div class="inv-notes"><h2>Notes</h2><p>' + esc(inv.notes) + '</p></div>' : '') +
          '<div class="inv-foot"><span>Nexora · External sales for digital agencies</span><span>nexora7021@gmail.com</span></div>';

        document.title = inv.number + ' — Nexora';

        $('#print-btn').addEventListener('click', () => window.print());
        $('#print-btn').disabled = false;
        $('#invoice-sheet').setAttribute('aria-busy', 'false');
      }).catch((err) => {
        $('#invoice-sheet').innerHTML = '<div class="invoice-loading">' + esc(err.message || 'Could not load invoice.') + '</div>';
        $('#invoice-sheet').setAttribute('aria-busy', 'false');
      });
    }
  }

  const year = $('#year');
  if (year) year.textContent = new Date().getFullYear();
})();
