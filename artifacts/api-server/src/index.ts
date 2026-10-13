import app from "./app";
import { logger } from "./lib/logger";
import { seedDatabase } from "@workspace/db";
import { processDeliveries } from "./lib/notificationDispatch";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start(): Promise<void> {
  // Await idempotent seeding before we begin accepting traffic so the first
  // requests never race a half-populated database. seedDatabase() is
  // self-guarding (onConflictDoNothing) and swallows its own errors, so this
  // await is safe and non-fatal even if seeding cannot complete.
  try {
    await seedDatabase();
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "[seed] non-fatal: continuing startup without completed seed",
    );
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });

  // Background worker: retry due notification deliveries (bounded backoff is
  // recorded per row). Non-fatal; failures are swallowed and retried next tick.
  const DELIVERY_TICK_MS = Number(process.env.DELIVERY_WORKER_INTERVAL_MS ?? 60_000);
  if (DELIVERY_TICK_MS > 0) {
    const timer = setInterval(() => {
      void processDeliveries({ limit: 100 }).catch((err) =>
        logger.warn({ err: (err as Error).message }, "delivery worker tick failed"),
      );
    }, DELIVERY_TICK_MS);
    timer.unref();
  }
}

void start();
