'use strict';

const GTM_CONTAINER_ID = 'GTM-TFWF9BMK';

window.dataLayer = window.dataLayer || [];
window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });

function gtag() {
  window.dataLayer.push(arguments);
}

window.gtag = gtag;
gtag('js', new Date());

const gtmScript = document.createElement('script');
gtmScript.async = true;
gtmScript.src = `https://www.googletagmanager.com/gtm.js?id=${GTM_CONTAINER_ID}`;
document.head.appendChild(gtmScript);
