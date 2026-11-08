// stripe-churn-signals: flags early churn signals from Stripe webhooks into a CSV
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const Stripe = require('stripe');
const { classify } = require('./lib/signals');

const CSV_HEADER = 'timestamp,event_id,customer,signal,object_id\n';

// Event IDs already handled, kept in a file so Stripe's retries are ignored even after a restart.
function createEventStore(file) {
  const seen = new Set();
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) if (line) seen.add(line.trim());
  }
  return {
    has: (id) => seen.has(id),
    add: (id) => {
      seen.add(id);
      fs.appendFileSync(file, id + '\n');
    },
  };
}

function createApp({ webhookSecret, signalsFile, stateFile, log = console.log }) {
  if (!webhookSecret) throw new Error('webhookSecret is required');
  // The Stripe client is only used to verify webhook signatures; no API calls are made.
  const stripe = new Stripe(process.env.STRIPE_API_KEY || 'sk_unused');
  const store = createEventStore(stateFile);
  if (!fs.existsSync(signalsFile)) fs.writeFileSync(signalsFile, CSV_HEADER);

  const app = express();
  app.post('/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], webhookSecret);
    } catch (err) {
      return res.status(400).send(`Webhook error: ${err.message}`);
    }

    if (store.has(event.id)) return res.sendStatus(200);

    for (const s of classify(event)) {
      const row = [new Date().toISOString(), event.id, s.customer, s.signal, s.objectId].join(',');
      fs.appendFileSync(signalsFile, row + '\n');
      log(row);
    }
    store.add(event.id);
    res.sendStatus(200);
  });
  return app;
}

if (require.main === module) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('Missing STRIPE_WEBHOOK_SECRET. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
  const app = createApp({
    webhookSecret,
    signalsFile: path.resolve(process.env.SIGNALS_FILE || 'signals.csv'),
    stateFile: path.resolve(process.env.STATE_FILE || 'processed_events.txt'),
  });
  const port = process.env.PORT || 4242;
  app.listen(port, () => console.log(`Listening for Stripe webhooks on :${port}/stripe/webhook`));
}

module.exports = { createApp, createEventStore };
