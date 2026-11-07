// stripe-churn-signals: flags early churn signals from Stripe webhooks into signals.csv
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const Stripe = require('stripe');

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
if (!webhookSecret) {
  console.error('Missing STRIPE_WEBHOOK_SECRET. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

// The Stripe client is only used to verify webhook signatures; no API calls are made.
const stripe = new Stripe(process.env.STRIPE_API_KEY || 'sk_unused');
const OUT = path.join(__dirname, process.env.SIGNALS_FILE || 'signals.csv');
const seen = new Set();

if (!fs.existsSync(OUT)) fs.writeFileSync(OUT, 'timestamp,customer,signal,object_id\n');

function flag(customer, signal, objectId) {
  const row = [new Date().toISOString(), customer, signal, objectId].join(',');
  fs.appendFileSync(OUT, row + '\n');
  console.log(row);
}

const seats = (items) => items.data.reduce((n, i) => n + (i.quantity || 0), 0);
const hasNullPrice = (items) => items.data.some((i) => i.price && i.price.unit_amount == null);
const value = (items) =>
  items.data.reduce((n, i) => n + ((i.price && i.price.unit_amount) || 0) * (i.quantity || 0), 0);

const app = express();

app.post('/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], webhookSecret);
  } catch (err) {
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  if (seen.has(event.id)) return res.sendStatus(200);
  seen.add(event.id);

  const obj = event.data.object;
  const prev = event.data.previous_attributes || {};

  switch (event.type) {
    case 'customer.subscription.updated': {
      if (prev.cancel_at_period_end === false && obj.cancel_at_period_end) {
        flag(obj.customer, 'scheduled_cancel', obj.id);
      }
      if (prev.items) {
        if (seats(obj.items) < seats(prev.items)) flag(obj.customer, 'seat_drop', obj.id);
        if (!hasNullPrice(obj.items) && !hasNullPrice(prev.items) && value(obj.items) < value(prev.items)) {
          flag(obj.customer, 'downgrade', obj.id);
        }
      }
      break;
    }
    case 'customer.subscription.paused':
      flag(obj.customer, 'paused', obj.id);
      break;
    case 'customer.subscription.trial_will_end':
      flag(obj.customer, 'trial_ending', obj.id);
      break;
    case 'invoice.payment_failed':
      flag(obj.customer, obj.next_payment_attempt ? 'payment_retrying' : 'payment_final', obj.id);
      break;
    case 'invoice.upcoming':
      flag(obj.customer, 'renewal_upcoming', obj.subscription || 'upcoming');
      break;
    default:
      break;
  }

  res.sendStatus(200);
});

const port = process.env.PORT || 4242;
app.listen(port, () => console.log(`Listening for Stripe webhooks on :${port}/stripe/webhook`));
