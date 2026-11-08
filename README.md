# stripe-churn-signals

[![test](https://github.com/north-metric/stripe-churn-signals/actions/workflows/test.yml/badge.svg)](https://github.com/north-metric/stripe-churn-signals/actions/workflows/test.yml)

A small, dependency-light Stripe webhook listener that flags early churn signals and writes them to a CSV you can open in any spreadsheet. No data team or warehouse needed.

Most small SaaS teams find out about churn from a "subscription canceled" email. By then the customer decided weeks ago. Stripe already records most of the warning signs; this repo listens for them and keeps a running list.

## Signals it flags

| Signal | Stripe source | Flag written |
|---|---|---|
| Scheduled cancellation | `customer.subscription.updated` where `cancel_at_period_end` flips to `true` | `scheduled_cancel` |
| Seat drop | `customer.subscription.updated`, total item `quantity` went down | `seat_drop` |
| Downgrade | `customer.subscription.updated`, total value went down after normalizing every price to a monthly amount (interval and `interval_count`), same currency only | `downgrade` |
| Currency change | `customer.subscription.updated`, items moved to a different currency (never compared as a downgrade) | `currency_change` |
| Failed payment, retries left | `invoice.payment_failed` with `next_payment_attempt` set | `payment_retrying` |
| Failed payment, retries over | `invoice.payment_failed` with `next_payment_attempt` = `null` | `payment_final` |
| Subscription paused | `customer.subscription.paused` | `paused` |
| Trial ending | `customer.subscription.trial_will_end` | `trial_ending` |
| Renewal coming up | `invoice.upcoming` | `renewal_upcoming` |

Card expiry and usage declines aren't webhook events. See [CHECKLIST.md](CHECKLIST.md) for a weekly routine that covers them. For the full reference (signals, decline codes and first moves), see the [Stripe churn signals field guide](https://north-metric.github.io/).

## Quick start

```bash
git clone https://github.com/north-metric/stripe-churn-signals.git
cd stripe-churn-signals
npm install
cp .env.example .env   # add your keys
npm test               # 17 tests, no Stripe account needed
npm start              # listens on PORT (default 4242)
```

Forward events locally with the Stripe CLI:

```bash
stripe listen --forward-to localhost:4242/stripe/webhook
```

Then point a webhook endpoint in the Stripe dashboard at `/stripe/webhook` and subscribe it to:

```
customer.subscription.updated
customer.subscription.paused
customer.subscription.trial_will_end
invoice.payment_failed
invoice.upcoming
```

Flags are appended to `signals.csv`:

```
timestamp,event_id,customer,signal,object_id
2026-11-07T10:12:03.000Z,evt_1Q...,cus_123,seat_drop,sub_456
```

## Keys and permissions

- The listener only reads webhook payloads. It never calls the Stripe API to change anything.
- `STRIPE_WEBHOOK_SECRET` (from the endpoint settings) is required to verify signatures.
- Never commit `.env`. It's already in `.gitignore`.

## Notes

- **Downgrades** are compared in monthly terms, so moving from $1,000/year to $100/month is not flagged (it's $1,200 a year). Metered, tiered and mixed-currency subscriptions are skipped rather than guessed at; compare upcoming invoice amounts for those.
- Webhook field names can change between Stripe API versions. Check them against the version your account is pinned to.
- **Retries:** Stripe can deliver the same event more than once. Processed event IDs are stored in `STATE_FILE` (default `processed_events.txt`), so duplicates are ignored across restarts. For multiple instances, swap the file store in `index.js` for a shared database table.
- **Ordering:** Stripe doesn't guarantee event order. Each signal is derived from a single event's own `previous_attributes`, so out-of-order delivery doesn't change the result.
- `invoice.upcoming` reads the subscription from both the older `invoice.subscription` field and the newer `parent.subscription_details.subscription`.

## Tests

`npm test` runs Node's built-in test runner. It has two layers, and CI runs both on Node 20, 22 and 24 for every push:

- `test/signals.test.js` covers the classification rules: scheduled cancels, seat drops, monthly vs annual and quarterly normalization, currency changes, metered and tiered prices, payment retry states, and old and new invoice shapes.
- `test/webhook.test.js` sends real signed payloads (`stripe.webhooks.generateTestHeaderString`) through the HTTP endpoint. It checks the CSV output, rejects bad signatures, and ignores a retried event even after a restart.

## License

MIT. See [LICENSE](LICENSE).

---

Maintained by [North Metric](https://www.northmetric.io), churn prevention for SaaS on Stripe. Issues and pull requests are welcome.
