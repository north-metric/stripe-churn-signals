const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, monthlyValue } = require('../lib/signals');

const price = (unit_amount, interval = 'month', opts = {}) => ({
  unit_amount,
  currency: opts.currency || 'usd',
  recurring: { interval, interval_count: opts.count || 1, usage_type: opts.usage || 'licensed' },
});
const items = (...list) => ({ data: list.map(([p, quantity]) => ({ price: p, quantity })) });
const subUpdated = (current, previous) => ({
  id: 'evt_test',
  type: 'customer.subscription.updated',
  data: { object: { id: 'sub_1', customer: 'cus_1', cancel_at_period_end: false, ...current }, previous_attributes: previous },
});
const signals = (event) => classify(event).map((s) => s.signal);

test('scheduled cancellation is flagged when cancel_at_period_end flips to true', () => {
  const e = subUpdated({ cancel_at_period_end: true, items: items([price(5000), 1]) }, { cancel_at_period_end: false });
  assert.deepEqual(signals(e), ['scheduled_cancel']);
});

test('seat drop is flagged', () => {
  const e = subUpdated({ items: items([price(1000), 4]) }, { items: items([price(1000), 10]) });
  assert.deepEqual(signals(e), ['seat_drop', 'downgrade']);
});

test('seat increase is not flagged', () => {
  const e = subUpdated({ items: items([price(1000), 10]) }, { items: items([price(1000), 4]) });
  assert.deepEqual(signals(e), []);
});

test('cheaper monthly price is a downgrade', () => {
  const e = subUpdated({ items: items([price(4900), 1]) }, { items: items([price(9900), 1]) });
  assert.deepEqual(signals(e), ['downgrade']);
});

test('annual $1,000 to monthly $100 is NOT a downgrade (it is $1,200 a year)', () => {
  const e = subUpdated({ items: items([price(10000, 'month'), 1]) }, { items: items([price(100000, 'year'), 1]) });
  assert.deepEqual(signals(e), []);
});

test('monthly $100 to annual $1,000 IS a downgrade in monthly terms', () => {
  const e = subUpdated({ items: items([price(100000, 'year'), 1]) }, { items: items([price(10000, 'month'), 1]) });
  assert.deepEqual(signals(e), ['downgrade']);
});

test('interval_count is respected (quarterly vs monthly)', () => {
  const quarterly = monthlyValue(items([price(30000, 'month', { count: 3 }), 1]));
  assert.equal(quarterly.amount, 10000);
});

test('currency change is reported as its own signal, never as a downgrade', () => {
  const e = subUpdated(
    { items: items([price(4000, 'month', { currency: 'eur' }), 1]) },
    { items: items([price(5000, 'month', { currency: 'usd' }), 1]) }
  );
  assert.deepEqual(signals(e), ['currency_change']);
});

test('metered and tiered prices are skipped for value comparison', () => {
  const metered = subUpdated(
    { items: items([price(1, 'month', { usage: 'metered' }), undefined]) },
    { items: items([price(5, 'month', { usage: 'metered' }), undefined]) }
  );
  assert.deepEqual(signals(metered), []);
  const tiered = subUpdated({ items: items([price(null), 5]) }, { items: items([price(null), 5]) });
  assert.deepEqual(signals(tiered), []);
});

test('failed payment with retries left vs retries over', () => {
  const base = { id: 'evt_x', type: 'invoice.payment_failed' };
  assert.deepEqual(signals({ ...base, data: { object: { id: 'in_1', customer: 'cus_1', next_payment_attempt: 1790000000 } } }), ['payment_retrying']);
  assert.deepEqual(signals({ ...base, data: { object: { id: 'in_1', customer: 'cus_1', next_payment_attempt: null } } }), ['payment_final']);
});

test('upcoming renewal reads the subscription on old and new API versions', () => {
  const oldShape = { id: 'e', type: 'invoice.upcoming', data: { object: { customer: 'cus_1', subscription: 'sub_old' } } };
  const newShape = { id: 'e', type: 'invoice.upcoming', data: { object: { customer: 'cus_1', parent: { subscription_details: { subscription: 'sub_new' } } } } };
  assert.equal(classify(oldShape)[0].objectId, 'sub_old');
  assert.equal(classify(newShape)[0].objectId, 'sub_new');
});

test('paused and trial ending', () => {
  const ev = (type) => ({ id: 'e', type, data: { object: { id: 'sub_1', customer: 'cus_1' } } });
  assert.deepEqual(signals(ev('customer.subscription.paused')), ['paused']);
  assert.deepEqual(signals(ev('customer.subscription.trial_will_end')), ['trial_ending']);
});

test('unrelated events produce no signals', () => {
  assert.deepEqual(signals({ id: 'e', type: 'charge.succeeded', data: { object: { id: 'ch_1' } } }), []);
});
