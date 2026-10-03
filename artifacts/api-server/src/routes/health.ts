import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { HealthCheckResponse } from "@workspace/api-zod";
import { isStripeConfigured } from "../lib/stripeClient";
import { isEmailConfigured } from "../lib/email";

const router: IRouter = Router();

// Liveness: process is up and serving. Kept aligned with the OpenAPI contract.
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * Report capability states without leaking any secret values. Each capability
 * reports only whether it is configured — never the underlying key or URL.
 */
async function capabilitySnapshot(): Promise<
  Record<string, "configured" | "unavailable">
> {
  const objectStorage =
    !!process.env.PRIVATE_OBJECT_DIR ||
    !!process.env.PUBLIC_OBJECT_SEARCH_PATHS;
  const openai =
    !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY &&
    !!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;

  return {
    storage: objectStorage ? "configured" : "unavailable",
    openai: openai ? "configured" : "unavailable",
    stripe: isStripeConfigured() ? "configured" : "unavailable",
    email: (await isEmailConfigured()) ? "configured" : "unavailable",
  };
}

/**
 * Readiness: verifies the core dependency (database) is reachable and reports
 * capability states for optional integrations. Returns 503 when core DB is
 * unavailable so orchestrators do not route traffic to a broken instance.
 */
router.get("/readyz", async (req, res): Promise<void> => {
  let databaseOk = false;
  try {
    await db.execute(sql`SELECT 1`);
    databaseOk = true;
  } catch (error: unknown) {
    req.log.error(
      {
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
      },
      "Readiness database check failed",
    );
  }

  const capabilities = await capabilitySnapshot();
  const status = databaseOk ? "ok" : "unavailable";

  res.status(databaseOk ? 200 : 503).json({
    status,
    checks: {
      database: databaseOk ? "ok" : "unavailable",
    },
    capabilities,
  });
});

export default router;
