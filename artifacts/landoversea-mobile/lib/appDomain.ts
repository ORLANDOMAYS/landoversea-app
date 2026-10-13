/**
 * Centralized, production-safe resolution of the LandOverSEA service domain.
 *
 * The deployment domain is injected at build time via EXPO_PUBLIC_DOMAIN and
 * varies between development, preview, and production. A signed release build
 * must point at an explicit HTTPS production origin — it must NEVER silently
 * fall back to a development/local host, which would either leak traffic to a
 * dev box or fail closed against an untrusted origin.
 *
 * API setup and authenticated media requests resolve the domain through this
 * helper so validation is applied consistently.
 */

export const CANONICAL_PRODUCTION_HOST = 'landover-sea.com';

// Hosts that are only ever valid in development. In a production build these
// indicate a misconfigured EXPO_PUBLIC_DOMAIN and must be rejected.
export function isDevOnlyHost(host: string): boolean {
  const lower = host.toLowerCase();
  return (
    lower === 'localhost' ||
    lower.endsWith('.local') ||
    lower.endsWith('.replit.app') ||
    lower.endsWith('.replit.dev') ||
    lower.endsWith('.repl.co') ||
    lower.startsWith('127.') ||
    lower.startsWith('10.') ||
    lower.startsWith('192.168.') ||
    lower.startsWith('0.0.0.0') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(lower)
  );
}

// Whether this bundle is running as a production/release build.
export function isProductionBuild(): boolean {
  return process.env.NODE_ENV === 'production' || __DEV__ === false;
}

export type ResolvedDomain =
  | { ok: true; host: string; origin: string; appUrl: string }
  | {
      ok: false;
      reason:
        | 'missing'
        | 'invalid'
        | 'not-https'
        | 'dev-host-in-production'
        | 'unexpected-production-host';
    };

/**
 * Validate the injected domain and derive the origin + landoversea app URL.
 *
 * Rules:
 * - EXPO_PUBLIC_DOMAIN must be set (a bare host, no scheme/path/credentials).
 * - It must resolve to a valid https:// origin.
 * - In a production build the host may not be a dev-only/local host.
 */
export function resolveDomain(
  rawDomain: string | undefined = process.env.EXPO_PUBLIC_DOMAIN,
  production: boolean = isProductionBuild(),
): ResolvedDomain {
  if (!rawDomain) return { ok: false, reason: 'missing' };

  const domain = rawDomain.trim();

  // Reject a domain that smuggles in a scheme, path, port, or credentials —
  // only a bare hostname is accepted.
  if (/[/@\s:]/.test(domain) || !/^[a-z0-9.-]+$/i.test(domain)) {
    return { ok: false, reason: 'invalid' };
  }

  let parsed: URL;
  try {
    parsed = new URL(`https://${domain}/`);
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  if (parsed.protocol !== 'https:') return { ok: false, reason: 'not-https' };

  if (production && isDevOnlyHost(parsed.host)) {
    return { ok: false, reason: 'dev-host-in-production' };
  }
  if (production && parsed.host !== CANONICAL_PRODUCTION_HOST) {
    return { ok: false, reason: 'unexpected-production-host' };
  }

  return {
    ok: true,
    host: parsed.host,
    origin: parsed.origin,
    appUrl: parsed.toString(),
  };
}
