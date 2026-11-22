/* Nexora client portal — sign in, progress tracking and client-scoped records. */
(function () {
  'use strict';

  const page = document.body.dataset.page || '';
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));

  const money = (value) => '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number(value) || 0);
  const cap = (value) => String(value || '').charAt(0).toUpperCase() + String(value || '').slice(1);
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  const PAYMENT_LABELS = {
    bank_transfer: 'Bank transfer', upi: 'UPI', card: 'Card',
    cash: 'Cash', cheque: 'Cheque', other: 'Other'
  };
  const VIEW_TITLES = {
    overview: ['Overview', 'Your engagement at a glance.'],
    orders: ['Orders', 'Every request you have sent us.'],
    invoices: ['Invoices', 'Issued invoices and payment status.'],
    profile: ['Profile', 'The details we use to run your engagement.']
  };

  function fmtDate(value, withTime) {
    if (!value) return '—';
    const parts = String(value).split(' ');
    const date = new Date(parts[0] + 'T00:00:00');
    if (isNaN(date)) return String(value);
    const formatted = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    return withTime && parts[1] ? formatted + ', ' + parts[1].slice(0, 5) : formatted;
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

    if (response.status === 401 && page !== 'client-login') {
      window.location.href = '/client/login';
      throw new Error('Session expired.');
    }
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  let toastTimer;
  function toast(message, isError) {
    const element = $('#portal-toast');
    if (!element) return;
    element.setAttribute('role', isError ? 'alert' : 'status');
    element.setAttribute('aria-live', isError ? 'assertive' : 'polite');
    element.classList.toggle('is-error', Boolean(isError));
    element.textContent = message;
    element.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { element.hidden = true; }, 6000);
  }

  let generatedId = 0;
  function setError(field, message) {
    if (!field.id) field.id = 'portal-field-' + (++generatedId);
    const id = field.id + '-error';
    const existing = document.getElementById(id);
    if (existing) existing.remove();
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

  function pill(status) {
    return '<span class="status-pill status-' + esc(status) + '">' + esc(cap(status)) + '</span>';
  }

  function emptyRow(columns, text) {
    return '<tr class="empty-row"><td colspan="' + columns + '">' + text + '</td></tr>';
  }

  /* ============================ CLIENT LOGIN ============================ */
  if (page === 'client-login') {
    const form = $('#client-login-form');
    const phone = $('#c-phone');
    const code = $('#c-code');
    const error = $('#client-login-error');
    const button = $('#client-login-submit');

    [phone, code].forEach((field) => field.addEventListener('input', () => {
      if (field.getAttribute('aria-invalid') === 'true') setError(field, '');
      error.textContent = '';
    }));

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.textContent = '';
      setError(phone, '');
      setError(code, '');

      const firstBad = !phone.value.trim() ? phone : !code.value.trim() ? code : null;
      if (firstBad) {
        setError(firstBad, 'Please fill this in.');
        firstBad.focus();
        return;
      }

      button.disabled = true;
      form.setAttribute('aria-busy', 'true');
      try {
        await api('/api/client/login', {
          method: 'POST',
          body: { phone: phone.value.trim(), code: code.value.trim() }
        });
        window.location.href = '/client';
      } catch (err) {
        error.textContent = err.message || 'Could not sign in.';
        button.disabled = false;
        form.removeAttribute('aria-busy');
        code.focus();
      }
    });
  }

  /* =========================== CLIENT PORTAL ============================ */
  if (page === 'client-portal') {
    const titles = VIEW_TITLES;
    const views = $('#portal-views');
    const links = $$('.portal-link');
    let state = { overview: null, orders: [], invoices: [], profile: null };

    function switchView(name) {
      if (!titles[name]) return;
      $$('.portal-view').forEach((view) => view.classList.toggle('is-active', view.dataset.view === name));
      links.forEach((link) => {
        const active = link.dataset.view === name;
        link.classList.toggle('is-active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
      $('#portal-title').textContent = titles[name][0];
      $('#portal-sub').textContent = titles[name][1];
    }

    function initials(name) {
      return String(name || '?').trim().split(/\s+/).slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase()).join('') || '?';
    }

    function renderSteps(progress) {
      $('#portal-steps').innerHTML = progress.steps.map((step, index) => {
        const marker = step.state === 'done' ? '✓' : String(index + 1).padStart(2, '0');
        const date = step.date
          ? '<time datetime="' + esc(String(step.date).slice(0, 10)) + '">' + esc(fmtDate(step.date)) + '</time>'
          : '';
        return '<li class="step step-' + esc(step.state) + '"' +
          (step.state === 'current' ? ' aria-current="step"' : '') + '>' +
          '<span class="step-marker" aria-hidden="true">' + marker + '</span>' +
          '<div><div class="step-label">' + esc(step.label) + date + '</div>' +
          '<p class="step-description">' + esc(step.description) + '</p></div></li>';
      }).join('');

      const currentStep = progress.steps.find((step) => step.state === 'current');
      const label = progress.complete
        ? 'All 5 steps complete'
        : 'Step ' + progress.current + ' of ' + progress.total + ' · ' + (currentStep ? currentStep.label : '');
      $('#portal-progress-label').textContent = label;
      $('#portal-welcome-copy').textContent = progress.complete
        ? 'Everything is complete. Thank you for working with Nexora.'
        : 'You are currently at: ' + (currentStep ? currentStep.label.toLowerCase() : 'the first step') +
          '. Track every stage below — this page updates as we move.';
    }

    function renderStats(stats) {
      const rows = [
        ['Active orders', String(stats.orders)],
        ['Issued invoices', String(stats.invoices)],
        ['Amount due', money(stats.due)],
        ['Amount paid', money(stats.paid)]
      ];
      $('#portal-stats').innerHTML = rows.map(([label, value]) =>
        '<div class="portal-stat"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>'
      ).join('');
      $('#portal-side-orders').textContent = String(stats.orders);
      $('#portal-side-invoices').textContent = String(stats.invoices);
    }

    function renderActivity(entries) {
      $('#portal-activity').innerHTML = entries.length
        ? entries.map((entry) =>
          '<li class="activity-item"><i aria-hidden="true"></i><div><b>' + esc(entry.title) + '</b>' +
          '<small>' + esc(entry.detail) + '</small></div><time datetime="' + esc(String(entry.date).slice(0, 10)) + '">' +
          esc(fmtDate(entry.date)) + '</time></li>'
        ).join('')
        : '<li class="portal-empty">No activity yet. We will show updates here as work begins.</li>';
    }

    function renderOrders(orders) {
      $('#portal-orders-body').innerHTML = orders.length
        ? orders.map((order) =>
          '<tr><td><b>' + esc(order.ref) + '</b></td><td>' + esc(order.service || '—') + '</td>' +
          '<td>' + pill(order.status) + '</td><td>' + esc(fmtDate(order.created_at)) + '</td></tr>'
        ).join('')
        : emptyRow(4, 'No orders are linked to your number yet.');
    }

    function renderInvoices(invoices) {
      $('#portal-invoices-body').innerHTML = invoices.length
        ? invoices.map((invoice) =>
          '<tr><td><b>' + esc(invoice.number) + '</b></td><td>' + esc(fmtDate(invoice.issue_date)) + '</td>' +
          '<td>' + esc(fmtDate(invoice.due_date)) + '</td><td><b>' + money(invoice.total) + '</b></td>' +
          '<td>' + pill(invoice.status) + '</td><td><a class="mini-btn" href="/client/invoice/' + invoice.id +
          '">View<span class="visually-hidden"> invoice ' + esc(invoice.number) + '</span></a></td></tr>'
        ).join('')
        : emptyRow(6, 'No invoices have been issued yet.');
    }

    function renderProfile(profile) {
      const details = [
        ['Agency', profile.agency], ['Contact', profile.contact_name],
        ['Email', profile.email], ['Phone', profile.phone],
        ['City', profile.city], ['Website', profile.website],
        ['Services', profile.services, true], ['Ideal customer', profile.target_profile, true],
        ['List source', profile.list_source], ['Monthly volume', profile.monthly_volume],
        ['Onboarding status', cap(profile.status)]
      ];
      $('#portal-profile').innerHTML = details.map(([label, value, wide]) =>
        '<div class="portal-detail' + (wide ? ' portal-detail-wide' : '') + '"><span>' + esc(label) +
        '</span><b>' + esc(value || '—') + '</b></div>'
      ).join('');
    }

    function render() {
      const heading = $('#overview-heading');
      heading.textContent = 'Welcome back, ' + (state.overview.account.contact_name || 'there') + '.';
      renderSteps(state.overview.progress);
      renderStats(state.overview.stats);
      renderActivity(state.overview.activity);
      renderOrders(state.orders);
      renderInvoices(state.invoices);
      renderProfile(state.profile);
      $('#portal-user-name').textContent = state.overview.account.contact_name;
      $('#portal-user-agency').textContent = state.overview.account.agency;
      $('#portal-initials').textContent = initials(state.overview.account.contact_name);
    }

    async function load() {
      views.setAttribute('aria-busy', 'true');
      try {
        const [overview, orders, invoices, profile] = await Promise.all([
          api('/api/client/overview'),
          api('/api/client/orders'),
          api('/api/client/invoices'),
          api('/api/client/profile')
        ]);
        state = { overview, orders, invoices, profile };
        render();
      } catch (err) {
        toast(err.message || 'Could not load your workspace.', true);
      } finally {
        views.removeAttribute('aria-busy');
      }
    }

    links.forEach((link) => link.addEventListener('click', () => {
      switchView(link.dataset.view);
      $('#portal-title').focus();
    }));

    $('#portal-logout').addEventListener('click', async () => {
      try { await api('/api/client/logout', { method: 'POST' }); } catch (_) { /* ignore */ }
      window.location.href = '/client/login';
    });

    load();
  }

  /* =========================== CLIENT INVOICE =========================== */
  if (page === 'client-invoice') {
    const match = window.location.pathname.match(/\/client\/invoice\/(\d+)/);
    const id = match ? match[1] : null;

    if (!id) {
      $('#invoice-sheet').innerHTML = '<div class="invoice-loading">Invalid invoice link.</div>';
      $('#invoice-sheet').setAttribute('aria-busy', 'false');
    } else {
      api('/api/client/invoices/' + id).then((invoice) => {
        $('#invoice-status').textContent = cap(invoice.status);
        $('#invoice-status').className = 'status-pill status-' + esc(invoice.status);

        const rows = invoice.items.map((item) =>
          '<tr><td>' + esc(item.description) + '</td><td class="num">' + esc(Number(item.qty)) + '</td>' +
          '<td class="num">' + money(item.rate) + '</td><td class="num">' + money(item.amount) + '</td></tr>'
        ).join('');
        const discount = Number(invoice.discount_amount) || 0;
        const discountRow = discount > 0
          ? '<div><span>Discount (' + esc(invoice.discount_percent) + '%)</span><span>−' + money(discount) + '</span></div>'
          : '';
        const payment = invoice.payment;
        const paymentLine = payment
          ? '<br>Paid: ' + esc(fmtDate(payment.paid_at, true)) + ' · ' + esc(PAYMENT_LABELS[payment.method] || payment.method)
          : '';

        $('#invoice-sheet').innerHTML =
          '<div class="inv-top"><div class="inv-brand"><img class="inv-mark" src="/assets/brand/nexora-mark.svg" alt=""><span>Nexora<span class="dot">.</span></span></div>' +
          '<div class="inv-title"><h1>INVOICE</h1><span>' + esc(invoice.number) + '</span></div></div>' +
          '<div class="inv-meta">' +
          '<div class="inv-block"><h2>Billed to</h2><p><b>' + esc(invoice.client_name) + '</b>' + esc(invoice.client_email || '') + '</p></div>' +
          '<div class="inv-block"><h2>Details</h2><p>Issued: ' + esc(fmtDate(invoice.issue_date)) +
          '<br>Due: ' + esc(fmtDate(invoice.due_date)) + '<br>Status: ' + esc(cap(invoice.status)) + paymentLine + '</p></div>' +
          '</div>' +
          '<table class="inv-table"><caption class="visually-hidden">Invoice line items</caption>' +
          '<thead><tr><th scope="col">Description</th><th scope="col" class="num">Qty</th>' +
          '<th scope="col" class="num">Rate</th><th scope="col" class="num">Amount</th></tr></thead><tbody>' + rows + '</tbody></table>' +
          '<div class="inv-totals"><div><span>Subtotal</span><span>' + money(invoice.subtotal) + '</span></div>' + discountRow +
          '<div><span>Tax (' + esc(invoice.tax_percent) + '%)</span><span>' + money(invoice.tax_amount) + '</span></div>' +
          '<div class="grand"><span>Total</span><span>' + money(invoice.total) + '</span></div></div>' +
          (invoice.notes ? '<div class="inv-notes"><h2>Notes</h2><p>' + esc(invoice.notes) + '</p></div>' : '') +
          '<div class="inv-foot"><span>Nexora · External sales for digital agencies</span><span>nexora7021@gmail.com</span></div>';

        document.title = invoice.number + ' — Nexora';
        $('#print-btn').disabled = false;
        $('#print-btn').addEventListener('click', () => window.print());
        $('#invoice-sheet').setAttribute('aria-busy', 'false');
      }).catch((err) => {
        $('#invoice-sheet').innerHTML = '<div class="invoice-loading">' + esc(err.message || 'Could not load invoice.') + '</div>';
        $('#invoice-sheet').setAttribute('aria-busy', 'false');
      });
    }
  }
})();
