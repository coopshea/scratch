import Stripe from 'stripe';
import type { Account, Accounts } from './accounts.ts';
import { HttpError } from './store.ts';

/**
 * Paying in through Stripe: a one-time top-up or a monthly subscription, for an amount the writer picks. Either adds
 * to their balance, which parses draw down by what they cost. A donation (a ream of paper) is separate and adds
 * nothing. Checkout and cancelling happen on Stripe's own pages; the webhook tells us what was paid. Amounts are set
 * per checkout, so nothing has to be created in Stripe first.
 */
export type Purchase = 'topup' | 'subscription' | 'donation';

/** A ream of paper. */
export const DONATION_CENTS = 700;

export interface Billing {
  /** A Stripe Checkout page for `cents`, once or monthly. */
  checkoutUrl(account: Account, origin: string, what: Purchase, cents: number): Promise<string>;
  /** Stripe's own page for changing card or cancelling. */
  portalUrl(account: Account, origin: string): Promise<string>;
  /** Verifies Stripe's signature, then applies the event. */
  webhook(raw: Buffer, signature: string): Promise<void>;
}

export const MIN_CENTS = 100;
export const MAX_CENTS = 10_000;

/** Stripe's standard card fee, taken out of what a payment adds to the balance. */
export const STRIPE_FEE = { percent: 2.9, cents: 30 };
/** What a payment adds to the balance, in micro-dollars. */
export const netMicros = (cents: number) => Math.max(0, Math.round((cents * (1 - STRIPE_FEE.percent / 100) - STRIPE_FEE.cents) * 10_000));

// Subscription states that keep it on. past_due keeps it while Stripe retries the card.
const ACTIVE = new Set(['active', 'trialing', 'past_due']);

export class StripeBilling implements Billing {
  private stripe: Stripe;
  constructor(private accounts: Accounts, secretKey: string, private webhookSecret: string) {
    this.stripe = new Stripe(secretKey);
  }

  async checkoutUrl(account: Account, origin: string, what: Purchase, cents: number) {
    const customer = await this.accounts.customerOf(account.id);
    // Read back from the signed webhook: whose balance, and whether this payment adds to it at all.
    const tag = { account: account.id, kind: what };
    const name = { topup: 'Scratch usage', subscription: 'Scratch usage, monthly', donation: 'A ream of paper for Cooper (donation)' }[what];
    const session = await this.stripe.checkout.sessions.create({
      mode: what === 'subscription' ? 'subscription' : 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd', unit_amount: what === 'donation' ? DONATION_CENTS : cents,
          product_data: { name },
          ...(what === 'subscription' ? { recurring: { interval: 'month' as const } } : {}),
        },
      }],
      client_reference_id: account.id,
      metadata: tag,
      ...(what === 'subscription' ? { subscription_data: { metadata: tag } } : {}),
      ...(customer ? { customer } : { customer_email: account.email ?? undefined }),
      ...(!customer && what !== 'subscription' ? { customer_creation: 'always' as const } : {}),
      success_url: `${origin}/?account&paid=${what}`,
      cancel_url: `${origin}/?account`,
    });
    if (!session.url) throw new HttpError(502, 'Stripe did not return a checkout page');
    return session.url;
  }

  async portalUrl(account: Account, origin: string) {
    const customer = await this.accounts.customerOf(account.id);
    if (!customer) throw new HttpError(400, 'No billing yet');
    const session = await this.stripe.billingPortal.sessions.create({ customer, return_url: `${origin}/?account` });
    return session.url;
  }

  async webhook(raw: Buffer, signature: string) {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(raw, signature, this.webhookSecret);
    } catch {
      throw new HttpError(400, 'Invalid signature');
    }
    await applyEvent(this.accounts, event);
  }
}

/** Separate from the signature check so tests can apply events directly. */
export async function applyEvent(accounts: Accounts, event: Stripe.Event) {
  if (!(await accounts.firstTime(event.id))) return; // Stripe retries deliveries; each event counts once
  try {
    await apply(accounts, event);
  } catch (e) {
    await accounts.forgetEvent(event.id); // so Stripe's retry can apply it
    throw e;
  }
}

async function apply(accounts: Accounts, event: Stripe.Event) {
  const customerId = (c: string | { id: string } | null) => (typeof c === 'string' ? c : c?.id ?? null);
  switch (event.type) {
    // A top-up is credited here; a donation is not. A subscription only starts here; its money arrives with each paid invoice.
    case 'checkout.session.completed': {
      const s = event.data.object;
      const id = s.metadata?.account;
      if (!id) return;
      const customer = customerId(s.customer);
      if (customer) await accounts.linkCustomer(id, customer);
      if (s.mode === 'payment' && s.metadata?.kind === 'topup' && s.payment_status === 'paid' && s.amount_total) {
        await accounts.addBalance(id, netMicros(s.amount_total));
      }
      if (s.mode === 'subscription' && s.status === 'complete') await accounts.setSubscribed(id, true);
      return;
    }
    // Every month's payment, the first included.
    case 'invoice.paid': {
      const inv = event.data.object;
      const id = inv.parent?.subscription_details?.metadata?.account;
      if (!id || !inv.amount_paid) return;
      const customer = customerId(inv.customer);
      if (customer) await accounts.linkCustomer(id, customer);
      await accounts.addBalance(id, netMicros(inv.amount_paid));
      return;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const id = sub.metadata?.account;
      if (id) await accounts.setSubscribed(id, event.type !== 'customer.subscription.deleted' && ACTIVE.has(sub.status));
      return;
    }
  }
}
