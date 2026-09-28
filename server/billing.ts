import Stripe from 'stripe';
import { PACK_PARSES, type Account, type Accounts } from './accounts.ts';
import { HttpError } from './store.ts';

/**
 * Paying for parses through Stripe: a one-time block of parses, or a monthly subscription. Checkout and cancelling
 * happen on Stripe's own pages; the webhook tells us what was paid for. Nothing about cards touches this server.
 */
export type Purchase = 'pack' | 'subscription';

export interface Billing {
  /** What is on sale, from which prices are configured. */
  offers: Record<Purchase, boolean>;
  /** A Stripe Checkout page for one purchase. */
  checkoutUrl(account: Account, origin: string, what: Purchase): Promise<string>;
  /** Stripe's own page for changing card or cancelling. */
  portalUrl(account: Account, origin: string): Promise<string>;
  /** Verifies Stripe's signature, then applies the event. */
  webhook(raw: Buffer, signature: string): Promise<void>;
}

// Subscription states that keep Pro on. past_due keeps it while Stripe retries the card.
const ACTIVE = new Set(['active', 'trialing', 'past_due']);

export class StripeBilling implements Billing {
  private stripe: Stripe;
  offers: Record<Purchase, boolean>;
  constructor(private accounts: Accounts, secretKey: string, private prices: Partial<Record<Purchase, string>>, private webhookSecret: string) {
    this.stripe = new Stripe(secretKey);
    this.offers = { pack: !!prices.pack, subscription: !!prices.subscription };
  }

  async checkoutUrl(account: Account, origin: string, what: Purchase) {
    const price = this.prices[what];
    if (!price) throw new HttpError(404, 'Not on sale');
    const customer = await this.accounts.customerOf(account.id);
    const session = await this.stripe.checkout.sessions.create({
      mode: what === 'pack' ? 'payment' : 'subscription',
      line_items: [{ price, quantity: 1 }],
      client_reference_id: account.id,
      // A block's size is fixed here, on the server, and read back from the signed webhook.
      metadata: what === 'pack' ? { parses: String(PACK_PARSES) } : {},
      ...(customer ? { customer } : what === 'pack' ? { customer_creation: 'always' as const } : {}),
      ...(customer ? {} : { customer_email: account.email ?? undefined }),
      success_url: `${origin}/?account&paid=${what}`,
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
    case 'checkout.session.completed': {
      const s = event.data.object;
      const id = s.client_reference_id;
      const customer = customerId(s.customer);
      if (!id) return;
      if (customer) await accounts.linkCustomer(id, customer);
      if (s.mode === 'payment' && s.payment_status === 'paid') {
        const n = Number(s.metadata?.parses);
        if (Number.isInteger(n) && n > 0) await accounts.addCredits(id, n);
      }
      // Subscription events can arrive before this one, when the customer was not linked yet; switch it on here too.
      if (s.mode === 'subscription' && customer && s.status === 'complete') await accounts.setProByCustomer(customer, true);
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
