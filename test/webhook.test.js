// End-to-end: real signed payloads through the Express app, the way Stripe sends them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Stripe = require('stripe');
const { createApp } = require('..');

const SECRET = 'whsec_test_secret';
const stripe = new Stripe('sk_unused');

function tmpFiles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'churn-signals-'));
  return { signalsFile: path.join(dir, 'signals.csv'), stateFile: path.join(dir, 'processed_events.txt') };
}

async function start(files) {
  const app = createApp({ webhookSecret: SECRET, ...files, log: () => {} });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return { url: `http://127.0.0.1:${server.address().port}/stripe/webhook`, close: () => new Promise((r) => server.close(r)) };
}

async function send(url, event, { secret = SECRET } = {}) {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload });
  return res.status;
}

const rows = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').slice(1);

const finalFailure = {
  id: 'evt_final_1',
  object: 'event',
  type: 'invoice.payment_failed',
  data: { object: { id: 'in_1', object: 'invoice', customer: 'cus_123', next_payment_attempt: null } },
};

test('a signed event is written to the CSV', async () => {
  const files = tmpFiles();
  const srv = await start(files);
  assert.equal(await send(srv.url, finalFailure), 200);
  await srv.close();
  const r = rows(files.signalsFile);
  assert.equal(r.length, 1);
  assert.match(r[0], /,evt_final_1,cus_123,payment_final,in_1$/);
});

test('a bad signature is rejected with 400 and nothing is written', async () => {
  const files = tmpFiles();
  const srv = await start(files);
  assert.equal(await send(srv.url, finalFailure, { secret: 'whsec_wrong' }), 400);
  await srv.close();
  assert.equal(rows(files.signalsFile).length, 0);
});

test('a retried event is ignored, including after a restart', async () => {
  const files = tmpFiles();
  let srv = await start(files);
  assert.equal(await send(srv.url, finalFailure), 200);
  assert.equal(await send(srv.url, finalFailure), 200);
  await srv.close();

  srv = await start(files); // simulate a process restart with the same state file
  assert.equal(await send(srv.url, finalFailure), 200);
  await srv.close();

  assert.equal(rows(files.signalsFile).length, 1);
});

test('annual-to-monthly plan change is not logged as a downgrade end to end', async () => {
  const files = tmpFiles();
  const srv = await start(files);
  const p = (amount, interval) => ({ unit_amount: amount, currency: 'usd', recurring: { interval, interval_count: 1, usage_type: 'licensed' } });
  const event = {
    id: 'evt_switch_1',
    object: 'event',
    type: 'customer.subscription.updated',
    data: {
      object: { id: 'sub_1', customer: 'cus_9', cancel_at_period_end: false, items: { data: [{ price: p(10000, 'month'), quantity: 1 }] } },
      previous_attributes: { items: { data: [{ price: p(100000, 'year'), quantity: 1 }] } },
    },
  };
  assert.equal(await send(srv.url, event), 200);
  await srv.close();
  assert.equal(rows(files.signalsFile).length, 0);
});
