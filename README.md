# stripe-churn-signals

A small, dependency-light Stripe webhook listener that flags early churn signals and writes them to a CSV you can open in any spreadsheet. No data team or warehouse needed.

Most small SaaS teams find out about churn from a "subscription canceled" email. By then the customer decided weeks ago. Stripe already records most of the warning signs; this repo listens for them and keeps a running list.

## Signals it flags

| Signal | Stripe source | Flag written |
|---|---|---|
| Scheduled cancellation | `customer.subscription.updated` where `cancel_at_period_end` flips to `true` | `scheduled_cancel` |
| Seat drop | `customer.subscription.updated`, total item `quantity` went down | `seat_drop` |
| Downgrade | `customer.subscription.updated`, total item value went down | `downgrade` |
| Failed payment, retries left | `invoice.payment_failed` with `next_payment_attempt` set | `payment_retrying` |
| Failed payment, retries over | `invoice.payment_failed` with `next_payment_attempt` = `null` | `payment_final` |
| Subscription paused | `customer.subscription.paused` | `paused` |
| Trial ending | `customer.subscription.trial_will_end` | `trial_ending` |
| Renewal coming up | `invoice.upcoming` | `renewal_upcoming` |

Card expiry and usage declines aren't webhook events. See [CHECKLIST.md](CHECKLIST.md) for a weekly routine that covers them.

## Quick start

```bash
git clone https://github.com/north-metric/stripe-churn-signals.git
cd stripe-churn-signals
npm install
cp .env.example .env   # add your keys
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
timestamp,customer,signal,object_id
2026-11-07T10:12:03.000Z,cus_123,seat_drop,sub_456
```

## Keys and permissions

- The listener only reads webhook payloads. It never calls the Stripe API to change anything.
- `STRIPE_WEBHOOK_SECRET` (from the endpoint settings) is required to verify signatures.
- Never commit `.env`. It's already in `.gitignore`.

## Notes

- If you use tiered or usage-based prices, `unit_amount` can be `null`, so the downgrade check skips those items. Compare upcoming invoice amounts instead.
- Webhook field names can change between Stripe API versions. Check them against the version your account is pinned to.
- Stripe retries webhooks, so the same event can arrive twice. The listener de-duplicates by event ID within one process run.

## License

MIT. See [LICENSE](LICENSE).

---

Maintained by [North Metric](https://www.northmetric.io), churn prevention for SaaS on Stripe. Issues and pull requests are welcome.
