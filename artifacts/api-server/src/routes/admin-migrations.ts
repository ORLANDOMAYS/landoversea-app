import { Router, type IRouter } from "express";
import { requireAdmin } from "../lib/auth";
import {
  runDryRun,
  runCommit,
  runRollback,
  listRuns,
  getRunDetail,
  getRunReport,
  MigrationError,
  type CommitDecisionInput,
  type ConflictDecision,
} from "../lib/base44-migration-service";
import type { Base44SourceInput } from "../lib/base44-migration-source";
import { parsePositiveSafeInteger } from "../lib/positiveSafeInteger";

const router: IRouter = Router();

const VALID_DECISIONS: ConflictDecision[] = ["use_base44", "keep_replit", "skip"];

function parseDecisions(raw: unknown): CommitDecisionInput[] {
  if (!Array.isArray(raw)) return [];
  const out: CommitDecisionInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { entityType, sourceId, decision, note } = item as Record<string, unknown>;
    if (typeof entityType !== "string" || typeof decision !== "string") continue;
    if (!VALID_DECISIONS.includes(decision as ConflictDecision)) continue;
    out.push({
      entityType,
      sourceId: String(sourceId),
      decision: decision as ConflictDecision,
      note: typeof note === "string" ? note : undefined,
    });
  }
  return out;
}

/**
 * Resolve the source input. Accepts an inline canonical snapshot OR
 * source:'configured' (which triggers a GET-only fetch from the configured
 * Base44 export URL). We never send a mutating request to Base44.
 */
function parseSourceInput(body: Record<string, unknown>): Base44SourceInput | { error: string } {
  if (body.source === "configured") {
    return { source: "configured" };
  }
  if (body.snapshot !== undefined) {
    return { source: "inline", snapshot: body.snapshot };
  }
  return { error: "Provide either 'snapshot' (inline) or source:'configured'" };
}

// POST /api/admin/migrations/dry-run
router.post("/admin/migrations/dry-run", requireAdmin, async (req, res): Promise<void> => {
  const actor = (req as any).user;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const input = parseSourceInput(body);
  if ("error" in input) {
    res.status(400).json({ error: input.error });
    return;
  }
  const decisions = parseDecisions(body.decisions);
  try {
    const result = await runDryRun({ actorUserId: actor.id, input, decisions });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof MigrationError) {
      req.log.warn({ code: err.code }, "Migration dry-run rejected");
      res.status(400).json({ error: err.message, code: err.code });
      return;
    }
    req.log.error({ err }, "Migration dry-run failed");
    res.status(400).json({ error: err instanceof Error ? err.message : "Dry run failed" });
  }
});

// POST /api/admin/migrations/commit
router.post("/admin/migrations/commit", requireAdmin, async (req, res): Promise<void> => {
  const actor = (req as any).user;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const dryRunId = parsePositiveSafeInteger(
    typeof body.dryRunId === "number" ? String(body.dryRunId) : body.dryRunId,
  );
  const snapshotHash = body.snapshotHash;
  if (dryRunId === null) {
    res.status(400).json({ error: "dryRunId is required" });
    return;
  }
  if (typeof snapshotHash !== "string" || snapshotHash.length === 0) {
    res.status(400).json({ error: "snapshotHash is required" });
    return;
  }
  const input = parseSourceInput(body);
  if ("error" in input) {
    res.status(400).json({ error: input.error });
    return;
  }
  const decisions = parseDecisions(body.decisions);
  try {
    const result = await runCommit({
      actorUserId: actor.id,
      dryRunId,
      snapshotHash,
      input,
      decisions,
    });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof MigrationError) {
      req.log.warn({ code: err.code }, "Migration commit rejected");
      res.status(409).json({ error: err.message, code: err.code });
      return;
    }
    req.log.error({ err }, "Migration commit failed");
    res.status(400).json({ error: err instanceof Error ? err.message : "Commit failed" });
  }
});

// POST /api/admin/migrations/:runId/rollback
router.post("/admin/migrations/:runId/rollback", requireAdmin, async (req, res): Promise<void> => {
  const actor = (req as any).user;
  const raw = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;
  const runId = parsePositiveSafeInteger(raw);
  if (runId === null) {
    res.status(400).json({ error: "Invalid runId" });
    return;
  }
  try {
    const result = await runRollback({ actorUserId: actor.id, runId });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof MigrationError) {
      req.log.warn({ code: err.code }, "Migration rollback rejected");
      res.status(409).json({ error: err.message, code: err.code });
      return;
    }
    req.log.error({ err }, "Migration rollback failed");
    res.status(400).json({ error: err instanceof Error ? err.message : "Rollback failed" });
  }
});

// GET /api/admin/migrations
router.get("/admin/migrations", requireAdmin, async (req, res): Promise<void> => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
  const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;
  const runs = await listRuns(limit, offset);
  res.json(runs);
});

// GET /api/admin/migrations/:runId
router.get("/admin/migrations/:runId", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;
  const runId = parsePositiveSafeInteger(raw);
  if (runId === null) {
    res.status(400).json({ error: "Invalid runId" });
    return;
  }
  const detail = await getRunDetail(runId);
  if (!detail) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json(detail);
});

// GET /api/admin/migrations/:runId/report
router.get("/admin/migrations/:runId/report", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;
  const runId = parsePositiveSafeInteger(raw);
  if (runId === null) {
    res.status(400).json({ error: "Invalid runId" });
    return;
  }
  const report = await getRunReport(runId);
  if (!report) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json(report);
});

export default router;
