// Pure classification logic: takes a verified Stripe event, returns the churn signals it contains.
// No I/O here, so every rule can be unit tested with plain fixtures.

// Average months per billing interval unit, used to normalize prices to a monthly amount.
const MONTHS_PER_UNIT = { day: 12 / 365, week: 12 / 52, month: 1, year: 12 };

// Monthly amount of one subscription item in the smallest currency unit (e.g. cents),
// or null when it can't be computed reliably (metered, tiered or non-recurring prices).
function itemMonthlyAmount(item) {
  const price = item && item.price;
  if (!price || !price.recurring) return null;
  if (price.recurring.usage_type === 'metered') return null;
  if (price.unit_amount == null) return null; // tiered or custom pricing
  const months = MONTHS_PER_UNIT[price.recurring.interval];
  if (!months) return null;
  const count = price.recurring.interval_count || 1;
  const quantity = item.quantity == null ? 1 : item.quantity;
  return (price.unit_amount * quantity) / (months * count);
}

// Normalized monthly value of a subscription's items: { amount, currency } or null if not comparable.
function monthlyValue(items) {
  const list = (items && items.data) || [];
  if (list.length === 0) return null;
  const currencies = new Set(list.map((i) => i.price && i.price.currency));
  if (currencies.size !== 1) return null; // mixed currencies: don't guess
  let amount = 0;
  for (const item of list) {
    const value = itemMonthlyAmount(item);
    if (value == null) return null;
    amount += value;
  }
  return { amount, currency: [...currencies][0] };
}

// Licensed seats only; metered items have no meaningful quantity.
function seats(items) {
  const list = (items && items.data) || [];
  return list
    .filter((i) => !(i.price && i.price.recurring && i.price.recurring.usage_type === 'metered'))
    .reduce((n, i) => n + (i.quantity || 0), 0);
}

// Newer Stripe API versions moved invoice.subscription under parent.subscription_details.
function invoiceSubscription(invoice) {
  if (invoice.subscription) return typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription.id;
  const details = invoice.parent && invoice.parent.subscription_details;
  if (details && details.subscription) return details.subscription;
  return null;
}

// Returns an array of { customer, signal, objectId }.
function classify(event) {
  const obj = event.data && event.data.object;
  if (!obj) return [];
  const prev = event.data.previous_attributes || {};
  const out = [];
  const add = (signal, objectId) => out.push({ customer: obj.customer, signal, objectId });

  switch (event.type) {
    case 'customer.subscription.updated': {
      if (prev.cancel_at_period_end === false && obj.cancel_at_period_end === true) {
        add('scheduled_cancel', obj.id);
      }
      if (prev.items) {
        if (seats(obj.items) < seats(prev.items)) add('seat_drop', obj.id);
        const before = monthlyValue(prev.items);
        const after = monthlyValue(obj.items);
        if (before && after) {
          if (before.currency !== after.currency) {
            add('currency_change', obj.id);
          } else if (after.amount < before.amount) {
            add('downgrade', obj.id);
          }
        }
      }
      break;
    }
    case 'customer.subscription.paused':
      add('paused', obj.id);
      break;
    case 'customer.subscription.trial_will_end':
      add('trial_ending', obj.id);
      break;
    case 'invoice.payment_failed':
      add(obj.next_payment_attempt ? 'payment_retrying' : 'payment_final', obj.id);
      break;
    case 'invoice.upcoming':
      add('renewal_upcoming', invoiceSubscription(obj) || 'upcoming');
      break;
    default:
      break;
  }
  return out;
}

module.exports = { classify, monthlyValue, itemMonthlyAmount, seats, invoiceSubscription };
