'use strict';

const db = require('./db');
const invoiceService = require('./invoices');
const { normalizePhone } = require('./client-accounts');

const STEP_DEFINITIONS = Object.freeze([
  { key: 'enquiry', label: 'Enquiry received', description: 'We have your request and a clear brief.' },
  { key: 'onboarding', label: 'Details submitted', description: 'Your onboarding details are on file.' },
  { key: 'approved', label: 'Approved & scheduled', description: 'Your engagement is signed off and being set up.' },
  { key: 'invoice', label: 'Invoice issued', description: 'The first invoice is ready for you to review.' },
  { key: 'live', label: 'Payment received', description: 'Payment is recorded and the engagement is live.' }
]);

function samePhone(left, right) {
  return Boolean(left && right && normalizePhone(left) === normalizePhone(right));
}

function sameEmail(left, right) {
  return Boolean(left && right && String(left).toLowerCase() === String(right).toLowerCase());
}

async function findLinkedClient(account) {
  if (account.client_id) {
    return db.prepare('SELECT * FROM clients WHERE id = ?').get(account.client_id) || null;
  }

  const clients = await db.prepare('SELECT * FROM clients WHERE is_sample = 0').all();
  return clients.find((client) => samePhone(client.phone, account.phone)) ||
    clients.find((client) => sameEmail(client.email, account.email)) ||
    null;
}

async function findRelatedOrders(account, client, emails) {
  const orders = await db.prepare(
    'SELECT * FROM orders ORDER BY datetime(created_at) DESC, id DESC'
  ).all();
  const includeSamples = Boolean(client && client.is_sample);

  return orders.filter((order) => {
    if (order.is_sample && !includeSamples) return false;
    return samePhone(order.phone, account.phone) || emails.includes(String(order.email || '').toLowerCase());
  });
}

function invoiceBelongsToClient(invoice, client, emails, orders) {
  if (client && invoice.client_id === client.id) return true;
  if (invoice.order_id && orders.some((order) => order.id === invoice.order_id)) return true;
  return emails.includes(String(invoice.client_email || '').toLowerCase());
}

async function findRelatedInvoices(account, client, emails, orders) {
  const includeSamples = Boolean(client && client.is_sample);
  return (await invoiceService.listInvoices()).filter((invoice) => {
    if (invoice.is_sample && !includeSamples) return false;
    if (invoice.status === 'draft') return false;
    return invoiceBelongsToClient(invoice, client, emails, orders);
  });
}

async function loadRelations(account) {
  const client = await findLinkedClient(account);
  const emails = [account.email, client && client.email]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  const orders = await findRelatedOrders(account, client, emails);
  const invoices = await findRelatedInvoices(account, client, emails, orders);
  return { client, orders, invoices };
}

function buildSteps(client, orders, invoices) {
  const issued = invoices.find((invoice) => invoice.status !== 'cancelled');
  const paid = invoices.find((invoice) => invoice.status === 'paid');
  const flags = [
    orders.length > 0,
    Boolean(client),
    Boolean(client && client.status === 'approved') || orders.some((order) => order.status === 'accepted'),
    Boolean(issued),
    Boolean(paid)
  ];
  const dates = [
    orders.length ? orders[orders.length - 1].created_at : null,
    client ? client.created_at : null,
    null,
    issued ? issued.issue_date : null,
    paid && paid.payment ? paid.payment.paid_at : null
  ];

  // Reaching a later stage implies the earlier stages already happened, even
  // when a record was created outside the usual enquiry-to-invoice flow.
  const highestDone = flags.lastIndexOf(true);
  const completed = highestDone + 1;

  const steps = STEP_DEFINITIONS.map((step, index) => ({
    key: step.key,
    label: step.label,
    description: step.description,
    state: index <= highestDone ? 'done' : index === highestDone + 1 ? 'current' : 'upcoming',
    date: dates[index] || null
  }));

  return {
    steps,
    completed,
    total: STEP_DEFINITIONS.length,
    current: Math.min(completed + 1, STEP_DEFINITIONS.length),
    complete: completed === STEP_DEFINITIONS.length
  };
}

function buildActivity(orders, invoices) {
  const entries = [];
  for (const order of orders) {
    entries.push({
      title: `Request ${order.ref} ${order.status}.`,
      detail: order.service || 'Engagement request',
      date: order.created_at,
      kind: 'order'
    });
  }
  for (const invoice of invoices) {
    entries.push({
      title: invoice.status === 'paid'
        ? `Payment received for ${invoice.number}.`
        : `Invoice ${invoice.number} ${invoice.status}.`,
      detail: `${invoice.client_name} · ₹${invoice.total}`,
      date: invoice.payment && invoice.payment.paid_at ? invoice.payment.paid_at : invoice.created_at,
      kind: 'invoice'
    });
  }
  return entries
    .sort((left, right) => String(right.date).localeCompare(String(left.date)))
    .slice(0, 5);
}

async function getOverview(account) {
  const { client, orders, invoices } = await loadRelations(account);
  const due = invoices
    .filter((invoice) => invoice.status === 'sent')
    .reduce((sum, invoice) => sum + invoice.total, 0);
  const paid = invoices
    .filter((invoice) => invoice.status === 'paid')
    .reduce((sum, invoice) => sum + invoice.total, 0);

  return {
    account: { agency: account.agency, contact_name: account.contact_name },
    progress: buildSteps(client, orders, invoices),
    stats: { orders: orders.length, invoices: invoices.length, due, paid },
    activity: buildActivity(orders, invoices)
  };
}

async function listOrders(account) {
  const { orders } = await loadRelations(account);
  return orders.map((order) => ({
    id: order.id,
    ref: order.ref,
    agency: order.agency,
    service: order.service,
    status: order.status,
    created_at: order.created_at
  }));
}

async function listInvoices(account) {
  const { invoices } = await loadRelations(account);
  return invoices.map((invoice) => ({
    id: invoice.id,
    number: invoice.number,
    client_name: invoice.client_name,
    issue_date: invoice.issue_date,
    due_date: invoice.due_date,
    total: invoice.total,
    status: invoice.status
  }));
}

async function readInvoice(account, id) {
  const { invoices } = await loadRelations(account);
  return invoices.find((invoice) => invoice.id === id) || null;
}

async function readProfile(account) {
  const { client } = await loadRelations(account);
  return {
    agency: client ? client.agency : account.agency,
    contact_name: client ? client.contact_name : account.contact_name,
    email: client ? client.email : account.email,
    phone: client && client.phone ? client.phone : account.phone,
    website: client ? client.website : '',
    city: client ? client.city : '',
    services: client ? client.services : '',
    target_profile: client ? client.target_profile : '',
    list_source: client ? client.list_source : '',
    monthly_volume: client ? client.monthly_volume : '',
    status: client ? client.status : 'not_submitted',
    submitted_at: client ? client.created_at : null
  };
}

module.exports = {
  STEP_DEFINITIONS,
  getOverview,
  listOrders,
  listInvoices,
  readInvoice,
  readProfile
};
