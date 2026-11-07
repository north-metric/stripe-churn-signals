# Weekly churn check for Stripe (about an hour)

A routine for small SaaS teams without a customer success team. Pair it with the webhook listener in this repo, or run it by hand from the Stripe dashboard.

## 1. Pull the lists

1. **Scheduled cancellations:** active subscriptions with `cancel_at_period_end = true`. If you use the customer portal with cancellation reasons on, read `cancellation_details`.
2. **Payment trouble:** subscriptions in `past_due`, plus any `payment_final` flags from the listener.
3. **Contraction:** `seat_drop` and `downgrade` flags from the last 7 days.
4. **Expiring cards:** default payment methods whose `card.exp_month` / `card.exp_year` fall this month or next. The card updater fixes many of these (`payment_method.automatically_updated`), but not all.
5. **Usage declines:** from your product analytics, accounts whose weekly active users or core actions dropped about 50% in the last 14 days against their own previous 28-day average.
6. **Renewals:** annual renewals in the next 30 to 60 days (`renewal_upcoming` flags).

## 2. Rank

- **High risk:** two or more strong signals (for example a failed payment plus a usage drop, or a seat drop plus a renewal within 30 days).
- **Medium:** one strong signal.
- **Low:** one weak signal.

Within each band, sort by monthly revenue. A medium-risk account paying $800 a month usually deserves attention before a high-risk one paying $19.

## 3. Act

| Signal | Usual first move |
|---|---|
| Failed payment, expired or wrong card | Card-update link right away |
| Failed payment, `insufficient_funds` | Let Smart Retries run first, then a short note |
| Scheduled cancellation | Personal note that addresses the stated reason |
| Seat drop or downgrade | Check in; offer a right-sized plan |
| Usage decline | Short check-in, or a help resource for the feature they stopped using |
| Renewal soon with weak usage | Value recap before the renewal date |

## 4. Close the loop

Log what you did and whether the customer stayed. After a few months you'll know which moves work for your product.

## Free settings worth turning on first

In Stripe's Billing settings: Smart Retries, failed-payment emails and expiring-card emails.
