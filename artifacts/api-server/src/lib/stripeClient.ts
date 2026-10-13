import Stripe from "stripe";

let _client: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return !!(process.env.STRIPE_SECRET_KEY);
}

export async function getStripeClient(): Promise<Stripe> {
  if (_client) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_NOT_CONFIGURED");
  _client = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });
  return _client;
}
