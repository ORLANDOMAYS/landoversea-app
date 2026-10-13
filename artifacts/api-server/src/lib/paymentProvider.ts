/**
 * Payment provider abstraction over Stripe.
 *
 * Routes payment-intent creation, refunds, and Connect transfers through a
 * narrow interface so tests can inject deterministic fake behavior without real
 * Stripe credentials. When Stripe is not configured, `getPaymentProvider()`
 * returns null and callers must return an explicit provider-unavailable
 * response — never a fake success.
 */
import { isStripeConfigured, getStripeClient } from "./stripeClient";

export interface CreatePaymentIntentInput {
  amount: number;
  currency: string;
  customerId?: string | null;
  metadata: Record<string, string>;
  idempotencyKey: string;
}

export interface PaymentIntentResult {
  id: string;
  clientSecret: string | null;
  customerId: string | null;
  status: string;
}

export interface CheckoutSessionInput {
  amount: number;
  currency: string;
  customerId?: string | null;
  bookingId: number;
  paymentId: number;
  description: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
}

export interface CheckoutSessionResult {
  id: string;
  url: string;
  customerId: string | null;
  paymentIntentId: string | null;
}

export interface RefundInput {
  paymentIntentId: string;
  amount?: number;
  reason?: string;
  idempotencyKey: string;
}

export interface RefundResult {
  id: string;
  status: string;
}

export interface TransferInput {
  amount: number;
  currency: string;
  destinationAccountId: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
}

export interface TransferResult {
  id: string;
  status: string;
}

export interface VerifiedEvent {
  id: string;
  type: string;
  data: { object: Record<string, any> };
}

export interface PaymentProvider {
  readonly name: string;
  ensureCustomer(input: { userId: number; email: string | null }): Promise<string>;
  createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentResult>;
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult>;
  expireCheckoutSession(sessionId: string): Promise<void>;
  createRefund(input: RefundInput): Promise<RefundResult>;
  createTransfer(input: TransferInput): Promise<TransferResult>;
  /** Verify a raw webhook body against the signing secret. Throws on failure. */
  verifyWebhook(rawBody: Buffer | string, signature: string): VerifiedEvent;
}

let _override: PaymentProvider | null = null;

function stripeProvider(): PaymentProvider {
  return {
    name: "stripe",
    async ensureCustomer(input) {
      const stripe = await getStripeClient();
      const customer = await stripe.customers.create({
        email: input.email ?? undefined,
        metadata: { userId: String(input.userId) },
      });
      return customer.id;
    },
    async createPaymentIntent(input) {
      const stripe = await getStripeClient();
      const pi = await stripe.paymentIntents.create(
        {
          amount: input.amount,
          currency: input.currency.toLowerCase(),
          customer: input.customerId ?? undefined,
          metadata: input.metadata,
          automatic_payment_methods: { enabled: true },
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return {
        id: pi.id,
        clientSecret: pi.client_secret ?? null,
        customerId: typeof pi.customer === "string" ? pi.customer : null,
        status: pi.status,
      };
    },
    async createCheckoutSession(input) {
      const stripe = await getStripeClient();
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          customer: input.customerId ?? undefined,
          client_reference_id: String(input.bookingId),
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: input.currency.toLowerCase(),
                unit_amount: input.amount,
                product_data: {
                  name: input.description,
                },
              },
            },
          ],
          payment_intent_data: {
            metadata: input.metadata,
          },
          metadata: {
            ...input.metadata,
            paymentId: String(input.paymentId),
          },
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
        },
        { idempotencyKey: input.idempotencyKey },
      );
      if (!session.url) throw new Error("Stripe did not return a checkout URL");
      return {
        id: session.id,
        url: session.url,
        customerId: typeof session.customer === "string" ? session.customer : null,
        paymentIntentId:
          typeof session.payment_intent === "string" ? session.payment_intent : null,
      };
    },
    async expireCheckoutSession(sessionId) {
      const stripe = await getStripeClient();
      await stripe.checkout.sessions.expire(sessionId);
    },
    async createRefund(input) {
      const stripe = await getStripeClient();
      const refund = await stripe.refunds.create(
        {
          payment_intent: input.paymentIntentId,
          amount: input.amount,
          reason: input.reason === "requested_by_customer" ? "requested_by_customer" : undefined,
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return { id: refund.id, status: refund.status ?? "pending" };
    },
    async createTransfer(input) {
      const stripe = await getStripeClient();
      const transfer = await stripe.transfers.create(
        {
          amount: input.amount,
          currency: input.currency.toLowerCase(),
          destination: input.destinationAccountId,
          metadata: input.metadata,
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return { id: transfer.id, status: "succeeded" };
    },
    verifyWebhook(rawBody, signature) {
      // Synchronous verification requires the client; getStripeClient is async,
      // so we construct a lightweight Stripe instance here via require path is
      // not possible. Instead this method is only used when configured and the
      // client is warmed. We import synchronously through the cached client.
      throw new Error("verifyWebhook must be called via verifyStripeWebhook");
    },
  };
}

export function isPaymentProviderConfigured(): boolean {
  return _override !== null || (isStripeConfigured() && isStripeWebhookConfigured());
}

export function getPaymentProvider(): PaymentProvider | null {
  if (_override) return _override;
  if (!isStripeConfigured() || !isStripeWebhookConfigured()) return null;
  return stripeProvider();
}

function isStripeWebhookConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET ||
      process.env.STRIPE_WEBHOOK_SECRET,
  );
}

/** Test-only injection of a fake provider. Pass null to restore Stripe. */
export function setPaymentProviderForTest(provider: PaymentProvider | null): void {
  _override = provider;
}

/**
 * Verify a Stripe webhook using the async client + signing secret. Falls back
 * to the injected fake provider's verifyWebhook when overridden (tests).
 */
export async function verifyStripeWebhook(rawBody: Buffer, signature: string): Promise<VerifiedEvent> {
  if (_override) return _override.verifyWebhook(rawBody, signature);
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET not configured");
  const stripe = await getStripeClient();
  const event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  return event as unknown as VerifiedEvent;
}
