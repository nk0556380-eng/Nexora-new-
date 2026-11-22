'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const TEMPLATES_DIR = path.join(ROOT, 'deploy', 'netlify');
const PAGES = [
  'premium.html', 'onboarding.html', 'login.html', 'dashboard.html', 'invoice.html',
  'client-login.html', 'client-portal.html', 'client-invoice.html'
];

const renderApiUrl = (process.env.RENDER_API_URL || '').replace(/\/+$/, '');
if (!renderApiUrl) {
  throw new Error(
    'RENDER_API_URL is required for the Netlify build, e.g. https://nexora-api.onrender.com'
  );
}
try {
  const parsed = new URL(renderApiUrl);
  if (parsed.protocol !== 'https:') throw new Error('https required');
} catch (_) {
  throw new Error('RENDER_API_URL must be an absolute HTTPS URL.');
}

fs.rmSync(PUBLIC_DIR, { recursive: true, force: true });
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

for (const page of PAGES) {
  fs.copyFileSync(path.join(ROOT, page), path.join(PUBLIC_DIR, page));
}
fs.cpSync(path.join(ROOT, 'assets'), path.join(PUBLIC_DIR, 'assets'), { recursive: true });

const redirects = fs.readFileSync(path.join(TEMPLATES_DIR, '_redirects'), 'utf8')
  .replaceAll('__RENDER_API_URL__', renderApiUrl);
fs.writeFileSync(path.join(PUBLIC_DIR, '_redirects'), redirects);
fs.copyFileSync(path.join(TEMPLATES_DIR, '_headers'), path.join(PUBLIC_DIR, '_headers'));

console.log(`Netlify static site written to public/ (API proxy → ${renderApiUrl})`);
