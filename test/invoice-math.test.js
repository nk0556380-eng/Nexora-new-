'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const money = require('../assets/js/money');

function invoice(overrides) {
  return {
    items: [{ description: 'Retainer', qty: 1, rate: 1000 }],
    tax_percent: 0,
    discount_percent: 0,
    ...overrides
  };
}

test('integer quantities multiply exactly', () => {
  const totals = money.compute(invoice({
    tax_percent: 18,
    items: [{ description: 'Retainer', qty: 2, rate: 1250 }]
  }));
  assert.equal(totals.subtotal, 2500);
  assert.equal(totals.tax_amount, 450);
  assert.equal(totals.total, 2950);
  assert.deepEqual(totals.items, [{ description: 'Retainer', qty: 2, rate: 1250, amount: 2500 }]);
});

test('decimal quantities round half-up once per line', () => {
  const totals = money.compute(invoice({
    items: [
      { description: 'Hours', qty: 1.5, rate: 100 },
      { description: 'Rounding', qty: 1.234, rate: 100 },
      { description: 'Half', qty: 1.235, rate: 100 },
      { description: 'Smallest', qty: 0.001, rate: 1000 }
    ]
  }));
  assert.deepEqual(totals.items.map((item) => item.amount), [150, 123, 124, 1]);
  assert.equal(totals.subtotal, 398);
});

test('tax is applied after discount and rounded half-up', () => {
  const totals = money.compute(invoice({
    items: [{ description: 'Retainer', qty: 1, rate: 20000 }],
    discount_percent: 10,
    tax_percent: 18
  }));
  assert.equal(totals.subtotal, 20000);
  assert.equal(totals.discount_amount, 2000);
  assert.equal(totals.tax_amount, 3240);
  assert.equal(totals.total, 21240);
});

test('fractional percentages use basis points', () => {
  const totals = money.compute(invoice({
    items: [{ description: 'Work', qty: 1, rate: 10000 }],
    discount_percent: 12.5,
    tax_percent: 18
  }));
  assert.equal(totals.discount_amount, 1250);
  assert.equal(totals.tax_amount, 1575);
  assert.equal(totals.total, 10325);
});

test('tax rounding uses half-up, not banker rounding', () => {
  const totals = money.compute(invoice({
    items: [{ description: 'Odd', qty: 1, rate: 999 }],
    tax_percent: 18
  }));
  assert.equal(totals.tax_amount, 180);
  assert.equal(totals.total, 1179);
});

test('quantities are limited to three decimals and positive values', () => {
  for (const qty of [0, -1, 0.0001, '2', null, undefined]) {
    assert.throws(() => money.compute(invoice({ items: [{ description: 'X', qty, rate: 100 }] })), /qty/);
  }
});

test('unit rates must be positive whole rupees', () => {
  for (const rate of [0, -100, 100.5, '1000', null, undefined]) {
    assert.throws(() => money.compute(invoice({ items: [{ description: 'X', qty: 1, rate }] })), /rate/);
  }
});

test('percentages are bounded and limited to two decimals', () => {
  assert.throws(() => money.compute(invoice({ tax_percent: 100.01 })), /tax_percent/);
  assert.throws(() => money.compute(invoice({ tax_percent: -1 })), /tax_percent/);
  assert.throws(() => money.compute(invoice({ tax_percent: 18.555 })), /decimal places/);
  assert.throws(() => money.compute(invoice({ discount_percent: 101 })), /discount_percent/);
  assert.throws(() => money.compute(invoice({ discount_percent: -0.5 })), /discount_percent/);
});

test('an invoice must have at least one line and a positive total', () => {
  assert.throws(() => money.compute(invoice({ items: [] })), /at least one/);
  assert.throws(() => money.compute(invoice({ discount_percent: 100 })), /at least ₹1/);
  assert.throws(
    () => money.compute(invoice({ items: [{ description: 'Tiny', qty: 0.001, rate: 1 }] })),
    /rounds to ₹0/
  );
});

test('no more than fifty line items are accepted', () => {
  const items = Array.from({ length: 51 }, (_, index) => ({
    description: `Line ${index}`,
    qty: 1,
    rate: 1
  }));
  assert.throws(() => money.compute(invoice({ items })), /50/);
});

test('the same input always produces the same result', () => {
  const payload = invoice({
    tax_percent: 18,
    discount_percent: 5,
    items: [
      { description: 'A', qty: 1.333, rate: 999 },
      { description: 'B', qty: 0.5, rate: 12345 }
    ]
  });
  assert.deepEqual(money.compute(payload), money.compute(payload));
});
