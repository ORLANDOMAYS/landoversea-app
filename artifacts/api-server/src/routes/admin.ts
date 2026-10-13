import { Router, type IRouter } from "express";
import { Readable } from "node:stream";
import {
  db, usersTable, profilesTable, profilePhotosTable, reportsTable,
  reportActionsTable, verificationRequestsTable, coachesTable, coachCredentialsTable,
  coachAuditEventsTable, premiumSubscriptionsTable, culturalFactsTable,
  matchesTable, conversationsTable, notificationsTable,
   accountDeletionRequestsTable,
} from "@workspace/db";
import { eq, and, desc, sql, count, ilike } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage";
import { parsePositiveSafeInteger } from "../lib/positiveSafeInteger";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

router.get("/admin/users", requireAdmin, async (req, res): Promise<void> => {
  const { q, role, status, limit: lim = "50", offset: off = "0" } = req.query as Record<string, string>;
  let users = await db.select().from(usersTable).limit(parseInt(lim)).offset(parseInt(off));
  if (q) users = users.filter((u) => u.email.includes(q) || u.name.toLowerCase().includes(q.toLowerCase()));
  if (role) users = users.filter((u) => u.role === role);
  if (status === "restricted") users = users.filter((u) => u.isRestricted);
  res.json(users.map((u) => ({ ...u, passwordHash: undefined })));
});

router.get("/admin/users/:userId", requireAdmin, async (req, res): Promise<void> => {
  const uId = parsePositiveSafeInteger(Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId);
  if (uId === null) { res.status(400).json({ error: "Invalid user id" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, uId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, uId)).limit(1);
  const photos = profile ? await db.select().from(profilePhotosTable).where(eq(profilePhotosTable.userId, uId)) : [];
  const [sub] = await db.select().from(premiumSubscriptionsTable).where(eq(premiumSubscriptionsTable.userId, uId)).limit(1);
  res.json({ ...user, passwordHash: undefined, profile: profile ? { ...profile, photos } : null, subscription: sub ?? null });
});

router.patch("/admin/users/:userId", requireAdmin, async (req, res): Promise<void> => {
  const uId = parsePositiveSafeInteger(Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId);
  if (uId === null) { res.status(400).json({ error: "Invalid user id" }); return; }
  const { role, isRestricted, restrictionReason, isPremium } = req.body;
  const updates: Record<string, any> = {};
  if (role !== undefined) updates.role = role;
  if (isRestricted !== undefined) updates.isRestricted = isRestricted;
  if (restrictionReason !== undefined) updates.restrictionReason = restrictionReason;
  if (isPremium !== undefined) updates.isPremium = isPremium;
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, uId)).returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  if (isPremium === true) {
    await db.insert(notificationsTable).values({
      userId: uId,
      type: 'premium',
      title: 'Premium activated!',
      body: 'Your First Class membership is now active.',
      idempotencyKey: 'premium-manual-' + uId + '-' + Date.now(),
    }).onConflictDoNothing();
  }

  res.json({ ...user, passwordHash: undefined });
});

router.get("/admin/reports", requireAdmin, async (req, res): Promise<void> => {
  const { status, limit: lim = "50", offset: off = "0" } = req.query as Record<string, string>;
  const where = status ? eq(reportsTable.status, status) : undefined;
  const reports = await db.select().from(reportsTable).where(where).orderBy(desc(reportsTable.createdAt)).limit(parseInt(lim)).offset(parseInt(off));
  const result = await Promise.all(reports.map(async (r) => {
    const [reporter] = await db.select().from(usersTable).where(eq(usersTable.id, r.reporterId)).limit(1);
    const [reported] = await db.select().from(usersTable).where(eq(usersTable.id, r.reportedId)).limit(1);
    return { ...r, reporter: reporter ? { id: reporter.id, name: reporter.name, email: reporter.email } : null, reported: reported ? { id: reported.id, name: reported.name, email: reported.email } : null };
  }));
  res.json(result);
});

// Audit-safe report status transitions: terminal states (dismissed/actioned)
// cannot change, and every transition is written to an immutable audit trail.
const REPORT_TRANSITIONS: Record<string, string[]> = {
  pending: ["reviewed", "dismissed", "actioned"],
  reviewed: ["dismissed", "actioned"],
  dismissed: [],
  actioned: [],
};

router.patch("/admin/reports/:reportId", requireAdmin, async (req, res): Promise<void> => {
  const admin = (req as any).user;
  const rId = parsePositiveSafeInteger(Array.isArray(req.params.reportId) ? req.params.reportId[0] : req.params.reportId);
  if (rId === null) { res.status(400).json({ error: "Invalid report id" }); return; }
  const { status, adminNotes } = req.body as { status?: string; adminNotes?: string };
  const target = status ?? "reviewed";
  if (!["reviewed", "dismissed", "actioned"].includes(target)) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    const [report] = await tx.select().from(reportsTable).where(eq(reportsTable.id, rId)).limit(1);
    if (!report) return { kind: "not_found" as const };
    if (!(REPORT_TRANSITIONS[report.status] ?? []).includes(target)) {
      return { kind: "invalid" as const, from: report.status };
    }
    const [updated] = await tx.update(reportsTable).set({
      status: target,
      adminNotes: adminNotes ?? report.adminNotes ?? null,
      reviewedBy: admin.id,
      reviewedAt: new Date(),
    }).where(eq(reportsTable.id, rId)).returning();
    await tx.insert(reportActionsTable).values({
      reportId: rId,
      adminId: admin.id,
      fromStatus: report.status,
      toStatus: target,
      notes: adminNotes ?? null,
    });
    return { kind: "ok" as const, report: updated };
  });

  if (outcome.kind === "not_found") { res.status(404).json({ error: "Report not found" }); return; }
  if (outcome.kind === "invalid") {
    res.status(409).json({ error: `Report is ${outcome.from} and cannot be changed to ${target}` });
    return;
  }
  res.json(outcome.report);
});

router.get("/admin/reports/:reportId/actions", requireAdmin, async (req, res): Promise<void> => {
  const rId = parsePositiveSafeInteger(Array.isArray(req.params.reportId) ? req.params.reportId[0] : req.params.reportId);
  if (rId === null) { res.status(400).json({ error: "Invalid report id" }); return; }
  const actions = await db.select().from(reportActionsTable)
    .where(eq(reportActionsTable.reportId, rId)).orderBy(desc(reportActionsTable.createdAt));
  res.json(actions);
});

router.get("/admin/verifications", requireAdmin, async (req, res): Promise<void> => {
  const { status = "pending", limit: lim = "50" } = req.query as Record<string, string>;
  const verifs = await db.select().from(verificationRequestsTable)
    .where(eq(verificationRequestsTable.status, status))
    .orderBy(desc(verificationRequestsTable.createdAt)).limit(parseInt(lim));
  const result = await Promise.all(verifs.map(async (v) => {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, v.userId)).limit(1);
    const { selfieUrl: _privateObjectPath, ...safeVerification } = v;
    return {
      ...safeVerification,
      selfieUrl: `/api/admin/verifications/${v.id}/document`,
      user: user ? { id: user.id, name: user.name, email: user.email } : null,
    };
  }));
  res.json(result);
});

router.get("/admin/verifications/:verificationId/document", requireAdmin, async (req, res): Promise<void> => {
  const vId = parsePositiveSafeInteger(Array.isArray(req.params.verificationId) ? req.params.verificationId[0] : req.params.verificationId);
  if (vId === null) { res.status(400).json({ error: "Invalid verification id" }); return; }

  const [verification] = await db.select({
    selfieUrl: verificationRequestsTable.selfieUrl,
  }).from(verificationRequestsTable)
    .where(eq(verificationRequestsTable.id, vId))
    .limit(1);
  if (!verification?.selfieUrl) { res.status(404).json({ error: "Document not found" }); return; }

  try {
    const objectFile = await objectStorageService.getObjectEntityFile(verification.selfieUrl);
    const response = await objectStorageService.downloadObject(objectFile, 0);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!response.body) { res.end(); return; }
    Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    req.log.error({ err: error, verificationId: vId }, "failed to stream verification document");
    res.status(500).json({ error: "Failed to serve verification document" });
  }
});

router.patch("/admin/verifications/:verificationId", requireAdmin, async (req, res): Promise<void> => {
  const vId = parsePositiveSafeInteger(Array.isArray(req.params.verificationId) ? req.params.verificationId[0] : req.params.verificationId);
  if (vId === null) { res.status(400).json({ error: "Invalid verification id" }); return; }
  const { status, adminNotes } = req.body;
  const [verif] = await db.update(verificationRequestsTable).set({
    status: status ?? "reviewed",
    adminNotes: adminNotes ?? null,
    reviewedAt: new Date(),
  }).where(eq(verificationRequestsTable.id, vId)).returning();
  if (!verif) { res.status(404).json({ error: "Not found" }); return; }

  if (status === "approved") {
    await db.update(profilesTable).set({ isVerified: true, verificationStatus: "approved" }).where(eq(profilesTable.userId, verif.userId));
  } else if (status === "rejected") {
    await db.update(profilesTable).set({ verificationStatus: "rejected" }).where(eq(profilesTable.userId, verif.userId));
  }

  await db.insert(notificationsTable).values({
    userId: verif.userId,
    type: 'verification',
    title: status === 'approved' ? 'Identity verified!' : 'Verification update',
    body: status === 'approved'
      ? 'Your profile badge is now live.'
      : (adminNotes ? 'Verification not approved: ' + adminNotes : 'Please resubmit your verification.'),
    idempotencyKey: 'verification-' + vId + '-' + status,
  }).onConflictDoNothing();

  res.json(verif);
});

router.get("/admin/analytics", requireAdmin, async (req, res): Promise<void> => {
  const [{ totalUsers }] = await db.select({ totalUsers: sql<number>`count(*)::int` }).from(usersTable);
  const [{ premiumUsers }] = await db.select({ premiumUsers: sql<number>`count(*)::int` }).from(usersTable).where(eq(usersTable.isPremium, true));
  const [{ totalMatches }] = await db.select({ totalMatches: sql<number>`count(*)::int` }).from(matchesTable);
  const [{ totalConversations }] = await db.select({ totalConversations: sql<number>`count(*)::int` }).from(conversationsTable);
  const [{ pendingReports }] = await db.select({ pendingReports: sql<number>`count(*)::int` }).from(reportsTable).where(eq(reportsTable.status, "pending"));
  const [{ pendingVerifications }] = await db.select({ pendingVerifications: sql<number>`count(*)::int` }).from(verificationRequestsTable).where(eq(verificationRequestsTable.status, "pending"));

  res.json({
    totalUsers,
    premiumUsers,
    activeSubscriptions: premiumUsers,
    totalMatches,
    totalConversations,
    pendingReports,
    pendingVerifications,
    conversionRate: totalUsers > 0 ? Math.round((premiumUsers / totalUsers) * 100) : 0,
  });
});

router.get("/admin/coaches", requireAdmin, async (req, res): Promise<void> => {
  const coaches = await db.select().from(coachesTable).orderBy(desc(coachesTable.createdAt)).limit(50);
  const result = await Promise.all(coaches.map(async (c) => {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, c.userId)).limit(1);
    return { ...c, user: user ? { id: user.id, name: user.name, email: user.email } : null };
  }));
  res.json(result);
});

router.patch("/admin/coaches/:coachId/verify", requireAdmin, async (req, res): Promise<void> => {
  const admin = (req as any).user;
  const cId = parsePositiveSafeInteger(Array.isArray(req.params.coachId) ? req.params.coachId[0] : req.params.coachId);
  if (cId === null) { res.status(400).json({ error: "Invalid coach id" }); return; }
  const {
    status: requestedStatus,
    notes,
    verified,
  } = req.body as { status?: string; notes?: string | null; verified?: boolean };
  // Preserve compatibility with the incoming boolean API while standardizing
  // all persisted verification states on approved/rejected.
  const status = requestedStatus
    ?? (typeof verified === "boolean" ? (verified ? "approved" : "rejected") : undefined);
  if (status !== "approved" && status !== "rejected") {
    res.status(400).json({ error: "status must be 'approved' or 'rejected'" });
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(coachesTable).where(eq(coachesTable.id, cId)).limit(1);
    if (!existing) return { kind: "not_found" as const };
    const [coach] = await tx.update(coachesTable).set({
      isVerified: status === "approved",
      verificationStatus: status,
    }).where(eq(coachesTable.id, cId)).returning();
    await tx.insert(coachAuditEventsTable).values({
      coachId: cId,
      actorUserId: admin.id,
      field: "verification",
      action: status,
      previousValue: existing.verificationStatus,
      newValue: status,
      notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
    });
    // Keep credential-document review in lockstep with the coach decision.
    await tx.update(coachCredentialsTable).set({
      status,
      reviewedBy: admin.id,
      reviewedAt: new Date(),
    }).where(and(
      eq(coachCredentialsTable.coachId, cId),
      eq(coachCredentialsTable.status, "pending"),
    ));
    return { kind: "updated" as const, coach, previous: existing };
  });
  if (outcome.kind === "not_found") { res.status(404).json({ error: "Coach not found" }); return; }

  await db.insert(notificationsTable).values({
    userId: outcome.coach.userId,
    type: "coach",
    title: status === "approved" ? "Coach application approved!" : "Coach application update",
    body: status === "approved"
      ? "You're live in the Coaches directory. Clients can now discover and book you."
      : (typeof notes === "string" && notes.trim()
        ? "Your coach application was not approved: " + notes.trim()
        : "Your coach application was not approved. You can update your details and resubmit."),
    idempotencyKey: `coach-verify-${cId}-${status}-${Date.now()}`,
  }).onConflictDoNothing();

  res.json(outcome.coach);
});

router.patch("/admin/coaches/:coachId/payout", requireAdmin, async (req, res): Promise<void> => {
  const admin = (req as any).user;
  const cId = parsePositiveSafeInteger(Array.isArray(req.params.coachId) ? req.params.coachId[0] : req.params.coachId);
  if (cId === null) { res.status(400).json({ error: "Invalid coach id" }); return; }
  const { isPayoutReady, notes } = req.body as { isPayoutReady?: boolean; notes?: string | null };
  if (typeof isPayoutReady !== "boolean") {
    res.status(400).json({ error: "isPayoutReady boolean is required" });
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(coachesTable).where(eq(coachesTable.id, cId)).limit(1);
    if (!existing) return { kind: "not_found" as const };
    const [coach] = await tx.update(coachesTable).set({ isPayoutReady })
      .where(eq(coachesTable.id, cId)).returning();
    await tx.insert(coachAuditEventsTable).values({
      coachId: cId,
      actorUserId: admin.id,
      field: "payout",
      action: isPayoutReady ? "payout_enabled" : "payout_disabled",
      previousValue: String(existing.isPayoutReady),
      newValue: String(isPayoutReady),
      notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
    });
    return { kind: "updated" as const, coach };
  });
  if (outcome.kind === "not_found") { res.status(404).json({ error: "Coach not found" }); return; }
  res.json(outcome.coach);
});

router.get("/admin/coaches/:coachId/audit", requireAdmin, async (req, res): Promise<void> => {
  const cId = parsePositiveSafeInteger(Array.isArray(req.params.coachId) ? req.params.coachId[0] : req.params.coachId);
  if (cId === null) { res.status(400).json({ error: "Invalid coach id" }); return; }
  const events = await db.select().from(coachAuditEventsTable)
    .where(eq(coachAuditEventsTable.coachId, cId))
    .orderBy(desc(coachAuditEventsTable.createdAt)).limit(100);
  const result = await Promise.all(events.map(async (e) => {
    const [actor] = await db.select().from(usersTable).where(eq(usersTable.id, e.actorUserId)).limit(1);
    return { ...e, actor: actor ? { id: actor.id, name: actor.name, email: actor.email } : null };
  }));
  res.json(result);
});

router.get("/admin/coaches/:coachId/credentials", requireAdmin, async (req, res): Promise<void> => {
  const cId = parsePositiveSafeInteger(Array.isArray(req.params.coachId) ? req.params.coachId[0] : req.params.coachId);
  if (cId === null) { res.status(400).json({ error: "Invalid coach id" }); return; }
  const creds = await db.select().from(coachCredentialsTable)
    .where(eq(coachCredentialsTable.coachId, cId)).orderBy(desc(coachCredentialsTable.createdAt));
  res.json(creds.map(({ objectPath: _privatePath, ...credential }) => ({
    ...credential,
    documentUrl: `/api/admin/coaches/${cId}/credentials/${credential.id}/document`,
  })));
});

router.get("/admin/coaches/:coachId/credentials/:credentialId/document", requireAdmin, async (req, res): Promise<void> => {
  const cId = parsePositiveSafeInteger(Array.isArray(req.params.coachId) ? req.params.coachId[0] : req.params.coachId);
  const credentialId = parsePositiveSafeInteger(Array.isArray(req.params.credentialId) ? req.params.credentialId[0] : req.params.credentialId);
  if (cId === null || credentialId === null) {
    res.status(400).json({ error: "Invalid credential id" });
    return;
  }
  const [credential] = await db.select().from(coachCredentialsTable).where(and(
    eq(coachCredentialsTable.id, credentialId),
    eq(coachCredentialsTable.coachId, cId),
  )).limit(1);
  if (!credential) { res.status(404).json({ error: "Credential not found" }); return; }
  try {
    const file = await objectStorageService.getObjectEntityFile(credential.objectPath);
    const response = await objectStorageService.downloadObject(file, 0);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("Content-Type", credential.contentType);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!response.body) { res.end(); return; }
    Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Credential not found" });
      return;
    }
    req.log.error({ err: error, credentialId }, "failed to stream coach credential");
    res.status(500).json({ error: "Failed to serve credential" });
  }
});

router.get("/admin/account-deletion-requests", requireAdmin, async (req, res): Promise<void> => {
  const status = typeof req.query.status === "string" ? req.query.status : "pending";
  const rows = await db.select().from(accountDeletionRequestsTable)
    .where(eq(accountDeletionRequestsTable.status, status))
    .orderBy(desc(accountDeletionRequestsTable.createdAt))
    .limit(100);
  res.json(rows);
});

router.patch("/admin/account-deletion-requests/:requestId", requireAdmin, async (req, res): Promise<void> => {
  const admin = (req as any).user;
  const requestId = parsePositiveSafeInteger(
    Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId,
  );
  const status = req.body?.status;
  if (requestId === null) {
    res.status(400).json({ error: "Invalid request ID" });
    return;
  }
  if (!["resolved", "dismissed"].includes(status)) {
    res.status(400).json({ error: "status must be resolved or dismissed" });
    return;
  }
  const [updated] = await db.update(accountDeletionRequestsTable).set({
    status,
    resolvedBy: admin.id,
    resolvedAt: new Date(),
  }).where(and(
    eq(accountDeletionRequestsTable.id, requestId),
    eq(accountDeletionRequestsTable.status, "pending"),
  )).returning();
  if (!updated) { res.status(409).json({ error: "Request is missing or already resolved" }); return; }
  res.json(updated);
});

// --- Culture-fact submission review ---
router.get("/admin/cultural-facts", requireAdmin, async (req, res): Promise<void> => {
  const { status = "pending" } = req.query as Record<string, string>;
  const facts = await db.select().from(culturalFactsTable)
    .where(eq(culturalFactsTable.status, status)).orderBy(desc(culturalFactsTable.createdAt)).limit(100);
  res.json(facts);
});

router.patch("/admin/cultural-facts/:factId", requireAdmin, async (req, res): Promise<void> => {
  const admin = (req as any).user;
  const fId = parsePositiveSafeInteger(Array.isArray(req.params.factId) ? req.params.factId[0] : req.params.factId);
  if (fId === null) { res.status(400).json({ error: "Invalid fact id" }); return; }
  const { status } = req.body as { status?: string };
  if (!status || !["approved", "rejected"].includes(status)) {
    res.status(400).json({ error: "status must be approved or rejected" });
    return;
  }
  const [fact] = await db.update(culturalFactsTable).set({
    status,
    reviewedBy: admin.id,
    reviewedAt: new Date(),
  }).where(eq(culturalFactsTable.id, fId)).returning();
  if (!fact) { res.status(404).json({ error: "Fact not found" }); return; }
  res.json(fact);
});

export default router;
