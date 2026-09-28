import Stripe from 'stripe';
import type { Account, Accounts } from './accounts.ts';
import { HttpError } from './store.ts';

/**
 * Pro, paid monthly through Stripe. Checkout and cancelling happen on Stripe's own pages; the webhook tells us
 * when a subscription starts, renews, lapses or ends. Nothing about cards ever touches this server.
 */
export interface Billing {
  /** A Stripe Checkout page for Pro. */
  checkoutUrl(account: Account, origin: string): Promise<string>;
  /** Stripe's own page for changing card or cancelling. */
  portalUrl(account: Account, origin: string): Promise<string>;
  /** Verifies Stripe's signature, then applies the event. */
  webhook(raw: Buffer, signature: string): Promise<void>;
}

// Subscription states that keep Pro on. past_due keeps it while Stripe retries the card.
const ACTIVE = new Set(['active', 'trialing', 'past_due']);

export class StripeBilling implements Billing {
  private stripe: Stripe;
  constructor(private accounts: Accounts, secretKey: string, private priceId: string, private webhookSecret: string) {
    this.stripe = new Stripe(secretKey);
  }

  async checkoutUrl(account: Account, origin: string) {
    const customer = await this.accounts.customerOf(account.id);
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: this.priceId, quantity: 1 }],
      client_reference_id: account.id,
      ...(customer ? { customer } : { customer_email: account.email ?? undefined }),
      success_url: `${origin}/?account&upgraded=1`,
      cancel_url: `${origin}/?account`,
      allow_promotion_codes: true,
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
  const customerId = (c: string | { id: string } | null) => (typeof c === 'string' ? c : c?.id ?? null);
  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object;
      const id = s.client_reference_id;
      const customer = customerId(s.customer);
      if (!id || !customer || s.mode !== 'subscription') return;
      await accounts.linkCustomer(id, customer);
      // Subscription events can arrive before this one, when the customer was not linked yet; switch Pro on here too.
      if (s.status === 'complete') await accounts.setProByCustomer(customer, true);
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const customer = customerId(sub.customer);
      if (customer) await accounts.setProByCustomer(customer, event.type !== 'customer.subscription.deleted' && ACTIVE.has(sub.status));
      return;
    }
  }
}
