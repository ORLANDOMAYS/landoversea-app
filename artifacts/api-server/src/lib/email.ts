import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

/**
 * Email provider abstraction.
 *
 * A provider is only considered configured when a trusted delivery channel is
 * present in the environment. When no provider is configured we must NOT invent
 * a delivery channel, and callers must surface an explicit "delivery
 * unavailable" state rather than silently succeeding or leaking a token.
 *
 * Supported HTTPS providers, in priority order:
 * - Resend with a direct RESEND_API_KEY
 * - Resend through an attached Replit Connector
 * - SendGrid with a direct SENDGRID_API_KEY
 *
 * SMTP is intentionally unsupported because Replit blocks the standard SMTP
 * ports. Keeping every provider on HTTPS also gives callers one truthful,
 * provider-independent acceptance result.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type EmailSendResult =
  | { ok: true; provider: string }
  | { ok: false; reason: "unavailable" | "error"; provider: string | null };

export type EmailProvider = {
  name: string;
  send: (message: EmailMessage) => Promise<void>;
};

function getFromAddress(): string {
  return (
    process.env.EMAIL_FROM ??
    process.env.MAIL_FROM ??
    "LandOverSEA <no-reply@landoversea.com>"
  );
}

function getFromEmailAddress(from: string): string {
  return from.match(/<([^>]+)>/)?.[1] ?? from;
}

function hasConnectorRuntime(): boolean {
  return Boolean(
    process.env.REPLIT_CONNECTORS_HOSTNAME ??
      process.env.CONNECTORS_HOSTNAME,
  );
}

const connectors = new ReplitConnectors();
const EMAIL_SEND_TIMEOUT_MS = 15_000;

async function sendWithTimeout(
  provider: EmailProvider,
  message: EmailMessage,
): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      provider.send(message),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Email provider timed out")),
          EMAIL_SEND_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function resolveEmailProviders(): EmailProvider[] {
  const providers: EmailProvider[] = [];
  const from = getFromAddress();

  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    providers.push({
      name: "resend",
      async send(message) {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${resendKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            ...(message.html ? { html: message.html } : {}),
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          throw new Error(`Resend responded with ${response.status}`);
        }
      },
    });
  }

  if (hasConnectorRuntime()) {
    providers.push({
      name: "resend-connector",
      async send(message) {
        const proxyFetch = connectors.createProxyFetch("resend");
        const response = await proxyFetch("/emails", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            ...(message.html ? { html: message.html } : {}),
          }),
          signal: AbortSignal.timeout(14_000),
        });
        if (!response.ok) {
          throw new Error(
            `Resend connector responded with ${response.status}`,
          );
        }
      },
    });
  }

  const sendgridKey = process.env.SENDGRID_API_KEY;
  if (sendgridKey) {
    providers.push({
      name: "sendgrid",
      async send(message) {
        const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: {
            authorization: `Bearer ${sendgridKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: message.to }] }],
            from: { email: getFromEmailAddress(from) },
            subject: message.subject,
            content: [
              { type: "text/plain", value: message.text },
              ...(message.html
                ? [{ type: "text/html", value: message.html }]
                : []),
            ],
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          throw new Error(`SendGrid responded with ${response.status}`);
        }
      },
    });
  }

  return providers;
}

/**
 * Whether a trusted delivery channel is currently configured. Used by the
 * readiness endpoint to report capability without exposing any secret value.
 */
export async function isEmailConfigured(): Promise<boolean> {
  if (process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY) {
    return true;
  }
  if (!hasConnectorRuntime()) {
    return false;
  }

  try {
    const connections = await connectors.listConnections({
      connector_names: "resend",
      refresh_policy: "none",
    });
    return connections.length > 0;
  } catch (error: unknown) {
    logger.warn(
      {
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
      },
      "Unable to check Resend connector availability",
    );
    return false;
  }
}

/**
 * Attempt to send an email. Never throws; returns a structured result so
 * recovery flows can keep their public response generic while still knowing
 * whether delivery is actually available.
 */
export async function sendEmail(
  message: EmailMessage,
): Promise<EmailSendResult> {
  const providers = resolveEmailProviders();
  if (providers.length === 0) {
    return { ok: false, reason: "unavailable", provider: null };
  }

  let lastFailedProvider: string | null = null;
  for (const provider of providers) {
    try {
      await sendWithTimeout(provider, message);
      return { ok: true, provider: provider.name };
    } catch (error: unknown) {
      lastFailedProvider = provider.name;
      logger.error(
        {
          provider: provider.name,
          errorType:
            error instanceof Error ? error.constructor.name : typeof error,
        },
        "Email delivery failed",
      );
    }
  }

  return { ok: false, reason: "error", provider: lastFailedProvider };
}
