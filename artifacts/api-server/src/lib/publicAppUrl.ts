import type { Request } from "express";

export const CANONICAL_PUBLIC_APP_URL = "https://landover-sea.com";
const LOCAL_DEVELOPMENT_URL = "http://localhost:3000";

export type PublicAppUrlConfig = {
  nodeEnv?: string;
  publicAppUrl?: string;
  allowedOrigins?: string;
  replitDomains?: string;
  requestOrigin?: string;
};

function normalizeOrigin(value: string, allowHttp: boolean): string | null {
  const candidate = value.trim();
  if (!candidate) return null;

  try {
    const parsed = new URL(candidate);
    const protocolAllowed =
      parsed.protocol === "https:" || (allowHttp && parsed.protocol === "http:");
    const isBareOrigin =
      protocolAllowed &&
      !parsed.username &&
      !parsed.password &&
      parsed.pathname === "/" &&
      !parsed.search &&
      !parsed.hash;
    return isBareOrigin ? parsed.origin : null;
  } catch {
    return null;
  }
}

function requireHttpsOrigin(value: string, label: string): string {
  const origin = normalizeOrigin(value, false);
  if (!origin) {
    throw new Error(`${label} must be a bare HTTPS origin`);
  }
  return origin;
}

export function resolvePublicAppUrl(config: PublicAppUrlConfig): string {
  if (config.nodeEnv === "production") {
    const configuredOrigin = requireHttpsOrigin(
      config.publicAppUrl?.trim() || CANONICAL_PUBLIC_APP_URL,
      "PUBLIC_APP_URL",
    );
    if (configuredOrigin !== CANONICAL_PUBLIC_APP_URL) {
      throw new Error(`PUBLIC_APP_URL must equal ${CANONICAL_PUBLIC_APP_URL} in production`);
    }
    return CANONICAL_PUBLIC_APP_URL;
  }

  if (config.requestOrigin) {
    const requestOrigin = normalizeOrigin(config.requestOrigin, true);
    if (!requestOrigin) {
      throw new Error("Unable to determine a safe application origin");
    }
    return requestOrigin;
  }

  return LOCAL_DEVELOPMENT_URL;
}

function getRequestOrigin(req: Pick<Request, "headers" | "protocol" | "get">): string {
  const protocol = String(req.headers["x-forwarded-proto"] ?? req.protocol ?? "http")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const host = String(req.headers["x-forwarded-host"] ?? req.get("host") ?? "")
    .split(",")[0]
    .trim();

  if (
    !["http", "https"].includes(protocol) ||
    !host ||
    !/^[a-z0-9.-]+(?::\d+)?$/i.test(host)
  ) {
    throw new Error("Unable to determine a safe application origin");
  }
  return `${protocol}://${host}`;
}

export function getPublicAppUrl(
  req?: Pick<Request, "headers" | "protocol" | "get">,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolvePublicAppUrl({
    nodeEnv: env.NODE_ENV,
    publicAppUrl: env.PUBLIC_APP_URL,
    requestOrigin: env.NODE_ENV === "production" || !req ? undefined : getRequestOrigin(req),
  });
}

export function getAllowedCorsOrigins(config: PublicAppUrlConfig): Set<string> {
  const origins = new Set<string>([CANONICAL_PUBLIC_APP_URL]);

  if (config.publicAppUrl?.trim()) {
    origins.add(resolvePublicAppUrl({
      nodeEnv: "production",
      publicAppUrl: config.publicAppUrl,
    }));
  }

  for (const value of (config.allowedOrigins ?? "").split(",").map(item => item.trim()).filter(Boolean)) {
    origins.add(requireHttpsOrigin(value, "ALLOWED_ORIGINS"));
  }

  for (const domain of (config.replitDomains ?? "").split(",").map(item => item.trim()).filter(Boolean)) {
    if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(domain)) {
      throw new Error("REPLIT_DOMAINS contains an invalid host");
    }
    origins.add(`https://${domain}`);
  }

  return origins;
}

export function getProductionCorsOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return getAllowedCorsOrigins({
    publicAppUrl: env.PUBLIC_APP_URL,
    allowedOrigins: env.ALLOWED_ORIGINS,
    replitDomains: env.REPLIT_DOMAINS,
  });
}