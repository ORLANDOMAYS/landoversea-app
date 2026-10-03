import express, { type Express, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import router from "./routes";
import { logger } from "./lib/logger";
import { getProductionCorsOrigins } from "./lib/publicAppUrl";

const app: Express = express();

// Replit terminates public traffic at a single trusted proxy before forwarding
// it to this service. This lets Express and the auth rate limiter use client IPs.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

const allowedOrigins = getProductionCorsOrigins();

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (process.env.NODE_ENV !== "production") return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      const error = new Error("Origin is not allowed");
      (error as Error & { status: number }).status = 403;
      callback(error);
    },
    credentials: true,
  }),
);

app.use(cookieParser());
// Stripe webhooks need raw body — MUST be before express.json()
app.use("/api/premium/webhook", express.raw({ type: "application/json" }));
app.use("/api/payments/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
  // Rate limiting protects production sign-in; automated regression tests in
  // development would otherwise trip it after 10 registrations.
  skip: () => process.env.NODE_ENV !== "production",
});

const authRecoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

export const VERIFY_EMAIL_RATE_LIMIT = {
  windowMs: 15 * 60 * 1000,
  max: 10,
} as const;

const verifyEmailLimiter = rateLimit({
  ...VERIFY_EMAIL_RATE_LIMIT,
  message: { error: "Too many attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
  // Production stays rate-limited. The explicit recovery test mode is only
  // enabled by the development workflow so deterministic E2E users sharing
  // one proxy IP cannot exhaust each other's verification bucket.
  skip: () =>
    process.env.NODE_ENV !== "production" &&
    process.env.AUTH_RECOVERY_TEST_MODE === "1",
});

app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/forgot-password", authRecoveryLimiter);
app.use("/api/auth/reset-password", authRecoveryLimiter);
app.use("/api/auth/verify-email", verifyEmailLimiter);

app.use("/api", router);

app.use((err: Error, _req: express.Request, res: express.Response, _next: NextFunction): void => {
  if (res.headersSent) return;
  const status = (err as any).status ?? (err as any).statusCode ?? 500;
  if (status >= 500) {
    _req.log.error(
      {
        status,
        errorType: err.constructor.name,
      },
      "Unhandled request error",
    );
  }
  const isInvalidJson =
    status === 400 &&
    err instanceof SyntaxError &&
    "body" in err;
  const message = isInvalidJson
    ? "Invalid JSON body"
    : process.env.NODE_ENV === "production" && status >= 500
      ? "Internal server error"
      : (err.message ?? "Request failed");
  res.status(status).json({ error: message });
});

export default app;
