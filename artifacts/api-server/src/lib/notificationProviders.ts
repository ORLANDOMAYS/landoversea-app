/**
 * Provider abstractions for out-of-band notification delivery (email + push).
 *
 * Providers are resolved from environment configuration. When the relevant
 * credentials are absent, the resolver returns `null` and callers keep a
 * truthful "skipped"/"unavailable" delivery state — never a fake success.
 *
 * A fake provider can be injected for deterministic tests via
 * `setNotificationProvidersForTest`.
 */

export type DeliveryChannel = "email" | "push" | "webhook";

export interface DispatchResult {
  providerMessageId: string;
}

export interface EmailProvider {
  readonly name: string;
  sendEmail(input: {
    to: string;
    subject: string;
    body: string;
    idempotencyKey: string;
  }): Promise<DispatchResult>;
}

export interface PushProvider {
  readonly name: string;
  sendPush(input: {
    tokens: string[];
    title: string;
    body: string;
    idempotencyKey: string;
  }): Promise<DispatchResult>;
}

export interface WebhookProvider {
  readonly name: string;
  sendWebhook(input: {
    url: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<DispatchResult>;
}

export interface NotificationProviders {
  email: EmailProvider | null;
  push: PushProvider | null;
  webhook: WebhookProvider | null;
}

// --- Real providers (thin abstractions; actual SDK wiring lands with creds) ---

function resolveEmailProvider(): EmailProvider | null {
  // Support common providers by presence of an API key. We never log the key.
  const apiKey = process.env.EMAIL_PROVIDER_API_KEY || process.env.SENDGRID_API_KEY;
  const from = process.env.EMAIL_FROM_ADDRESS;
  if (!apiKey || !from) return null;
  const endpoint = process.env.EMAIL_PROVIDER_ENDPOINT;
  return {
    name: "email-http",
    async sendEmail(input) {
      if (!endpoint) {
        // Configured key but no HTTP endpoint wiring: treat as unavailable so
        // we never pretend to have sent.
        throw new Error("EMAIL_PROVIDER_ENDPOINT not configured");
      }
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
          "idempotency-key": input.idempotencyKey,
        },
        body: JSON.stringify({ to: input.to, from, subject: input.subject, text: input.body }),
      });
      if (!res.ok) throw new Error(`email provider responded ${res.status}`);
      const id = res.headers.get("x-message-id") || input.idempotencyKey;
      return { providerMessageId: id };
    },
  };
}

function resolvePushProvider(): PushProvider | null {
  // Expo / FCM / APNs are all keyed off a server credential + endpoint.
  const endpoint = process.env.PUSH_PROVIDER_ENDPOINT;
  const key = process.env.PUSH_PROVIDER_API_KEY || process.env.FCM_SERVER_KEY;
  if (!endpoint || !key) return null;
  return {
    name: "push-http",
    async sendPush(input) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
          "idempotency-key": input.idempotencyKey,
        },
        body: JSON.stringify({ tokens: input.tokens, title: input.title, body: input.body }),
      });
      if (!res.ok) throw new Error(`push provider responded ${res.status}`);
      const id = res.headers.get("x-message-id") || input.idempotencyKey;
      return { providerMessageId: id };
    },
  };
}

function resolveWebhookProvider(): WebhookProvider | null {
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (!url) return null;
  return {
    name: "webhook-http",
    async sendWebhook(input) {
      const res = await fetch(input.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": input.idempotencyKey,
        },
        body: JSON.stringify(input.payload),
      });
      if (!res.ok) throw new Error(`webhook responded ${res.status}`);
      return { providerMessageId: input.idempotencyKey };
    },
  };
}

let _override: NotificationProviders | null = null;

export function getNotificationProviders(): NotificationProviders {
  if (_override) return _override;
  return {
    email: resolveEmailProvider(),
    push: resolvePushProvider(),
    webhook: resolveWebhookProvider(),
  };
}

/** Test-only: inject fake providers. Pass null to restore env resolution. */
export function setNotificationProvidersForTest(providers: NotificationProviders | null): void {
  _override = providers;
}
