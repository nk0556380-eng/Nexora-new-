'use strict';

// Demo rows injected only into an empty database. Kept as data so both DB
// drivers insert exactly the same fields in exactly the same order.

const ORDERS = [
  ['NXR-2026-001', 'Ananya Rao', 'Northstar Digital', 'ananya@northstar.example', '+91 98000 11101', 'Cold calling', 'We have a 400-account list but nobody follows up. Need a test run.', 'new'],
  ['NXR-2026-002', 'Rohan Mehta', 'Info Edgecombe', 'rohan@edgecombe.example', '+91 98000 11102', 'Appointment setting', 'Looking for a founder-level outreach partner for two months.', 'accepted'],
  ['NXR-2026-003', 'Priya Nair', 'Studio Fern', 'priya@studiofern.example', '+91 98000 11103', 'Cold calling', 'Want to trial outbound before the new quarter. List is ready.', 'new']
];

const CLIENTS = [
  ['Northstar Digital', 'Ananya Rao', 'ananya@northstar.example', '+91 98000 11101', 'northstar.example', 'Bengaluru', 'SEO, Performance', 'D2C founders, 20-200 crore revenue', 'Client-supplied, opt-in', '300-500', 'Start with a 2-week pilot.', 'pending'],
  ['Info Edgecombe', 'Rohan Mehta', 'rohan@edgecombe.example', '+91 98000 11102', 'edgecombe.example', 'Mumbai', 'Full-service', 'SaaS companies in India', 'Existing CRM, consented', '200', 'Need decision-maker level calls.', 'approved'],
  ['Studio Fern', 'Priya Nair', 'priya@studiofern.example', '+91 98000 11103', 'studiofern.example', 'Pune', 'Social, Web', 'Local retail brands', 'Client-supplied', '150', 'Follow-up cadence is the priority.', 'pending']
];

const INVOICE = {
  row: ['INV-2026-001', 2, 2, 'Info Edgecombe', 'rohan@edgecombe.example', '2026-11-10', '2026-11-25', 18, 50000, 9000, 59000, 'sent', 'Pilot month — call activity, qualification and weekly reporting.'],
  item: ['Cold calling & qualification — pilot month', 1, 50000, 50000]
};

const OUTREACH_LEADS = [
  ['northstar.digital.demo', 'Northstar Digital', 'Bengaluru', 'SEO and performance', 3200, 48, '2026-06-02', 9, 'Performance marketing for D2C brands.', 0, 0, 0, 10],
  ['studiofern.demo', 'Studio Fern', 'Pune', 'Social media and web', 860, 12, '2026-11-04', 11, 'We make brands look good online. DM for work.', 1, 1, 2, 45],
  ['edgecombe.demo', 'Info Edgecombe', 'Mumbai', 'Full-service agency', 14500, 210, '2026-11-16', 96, 'Full-service digital agency for SaaS and fintech teams in India. Strategy, content, paid media and lifecycle. Book a discovery call below.', 1, 1, 9, 35]
];

const ORDER_SQL = `
  INSERT INTO orders (ref, name, agency, email, phone, service, message, status, is_sample)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
`;
const CLIENT_SQL = `
  INSERT INTO clients (agency, contact_name, email, phone, website, city, services, target_profile, list_source, monthly_volume, notes, consent, status, is_sample)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1)
`;
const INVOICE_SQL = `
  INSERT INTO invoices (number, order_id, client_id, client_name, client_email, issue_date, due_date, tax_percent, subtotal, tax_amount, total, status, notes, is_sample)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
`;
const INVOICE_ITEM_SQL = 'INSERT INTO invoice_items (invoice_id, description, qty, rate, amount) VALUES (?, ?, ?, ?, ?)';
const OUTREACH_SQL = `
  INSERT INTO outreach_leads (
    handle, agency, city, niche, followers, post_count, last_post_on,
    avg_likes, bio, has_link, has_cta, highlight_count, reels_share, status, is_sample
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 1)
`;

module.exports = {
  ORDERS,
  CLIENTS,
  INVOICE,
  OUTREACH_LEADS,
  ORDER_SQL,
  CLIENT_SQL,
  INVOICE_SQL,
  INVOICE_ITEM_SQL,
  OUTREACH_SQL
};
