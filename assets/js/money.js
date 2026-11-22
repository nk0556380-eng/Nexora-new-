/*
 * Nexora invoice arithmetic.
 *
 * Shared by the browser preview and the server, so both apply exactly the same
 * rules. Money is stored and displayed in whole rupees (the product's existing
 * convention), so every calculation uses integer arithmetic and rounds half-up
 * once per step. Quantities allow up to 3 decimal places; percentages up to 2.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoraMoney = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const QTY_DECIMALS = 3;
  const PERCENT_DECIMALS = 2;
  const QTY_SCALE = 1000;
  const PERCENT_SCALE = 100;
  const PERCENT_DIVISOR = 100 * PERCENT_SCALE;
  const MAX_ITEMS = 50;
  const MAX_QTY = 100000;
  const MAX_RATE = 1000000000;

  function fail(message) {
    const error = new Error(message);
    error.name = 'MoneyError';
    error.status = 400;
    error.expose = true;
    throw error;
  }

  /** Parses a non-negative decimal number into an integer scaled by 10^decimals. */
  function scaled(value, decimals, scale, label) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      fail(`"${label}" must be a number.`);
    }
    const text = String(value);
    if (!/^\d+(\.\d+)?$/.test(text)) {
      fail(`"${label}" must be zero or greater.`);
    }
    const parts = text.split('.');
    const fraction = parts[1] || '';
    if (fraction.length > decimals) {
      fail(`"${label}" supports at most ${decimals} decimal places.`);
    }
    const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals);
    return Number(parts[0]) * scale + Number(padded || '0');
  }

  function quantity(value) {
    const milli = scaled(value, QTY_DECIMALS, QTY_SCALE, 'qty');
    if (milli <= 0) fail('"qty" must be greater than 0.');
    if (milli > MAX_QTY * QTY_SCALE) fail(`"qty" must be ${MAX_QTY} or less.`);
    return milli;
  }

  function unitRate(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
      fail('"rate" must be a whole number of rupees.');
    }
    if (value < 1 || value > MAX_RATE) {
      fail(`"rate" must be between 1 and ${MAX_RATE}.`);
    }
    return value;
  }

  function percentage(value, label) {
    const basisPoints = scaled(value, PERCENT_DECIMALS, PERCENT_SCALE, label);
    if (basisPoints > PERCENT_DIVISOR) fail(`"${label}" must be between 0 and 100.`);
    return basisPoints;
  }

  /** Half-up division for non-negative integers. */
  function roundHalfUp(numerator, denominator) {
    return Math.floor((numerator + denominator / 2) / denominator);
  }

  /**
   * Calculates an invoice from untrusted line items.
   * Returns per-line amounts plus subtotal, discount, tax and total in rupees.
   */
  function compute(input) {
    const source = input || {};
    const rawItems = Array.isArray(source.items) ? source.items : [];
    if (!rawItems.length) fail('"items" must contain at least one line item.');
    if (rawItems.length > MAX_ITEMS) fail(`"items" must contain ${MAX_ITEMS} items or fewer.`);

    const taxBasisPoints = source.tax_percent === undefined ? 0 : percentage(source.tax_percent, 'tax_percent');
    const discountBasisPoints = source.discount_percent === undefined
      ? 0
      : percentage(source.discount_percent, 'discount_percent');

    const items = rawItems.map((rawItem, index) => {
      const item = rawItem || {};
      const qtyMilli = quantity(item.qty);
      const rate = unitRate(item.rate);
      const amount = roundHalfUp(rate * qtyMilli, QTY_SCALE);
      if (amount < 1) {
        fail(`Line ${index + 1} rounds to ₹0; raise the quantity or unit price.`);
      }
      return {
        description: item.description == null ? '' : String(item.description),
        qty: qtyMilli / QTY_SCALE,
        rate,
        amount
      };
    });

    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    const discountAmount = roundHalfUp(subtotal * discountBasisPoints, PERCENT_DIVISOR);
    const taxable = subtotal - discountAmount;
    const taxAmount = roundHalfUp(taxable * taxBasisPoints, PERCENT_DIVISOR);
    const total = taxable + taxAmount;
    if (total < 1) fail('Invoice total must be at least ₹1.');

    return {
      items,
      subtotal,
      discount_percent: discountBasisPoints / PERCENT_SCALE,
      discount_amount: discountAmount,
      tax_percent: taxBasisPoints / PERCENT_SCALE,
      tax_amount: taxAmount,
      total
    };
  }

  return { compute };
});
