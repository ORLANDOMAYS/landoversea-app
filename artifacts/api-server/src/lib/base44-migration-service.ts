import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  profilesTable,
  matchesTable,
  conversationsTable,
  conversationParticipantsTable,
  messagesTable,
  premiumSubscriptionsTable,
  migrationRunsTable,
  migrationMappingsTable,
  migrationConflictsTable,
  migrationLedgerTable,
} from "@workspace/db";
import type {
  Base44Snapshot,
  Base44User,
  Base44Profile,
  Base44Match,
  Base44Conversation,
  Base44Message,
  Base44Premium,
  Base44SourceInput,
} from "./base44-migration-source";
import {
  hashValue,
  normalizeEmail,
  resolveBase44Snapshot,
  snapshotCounts,
} from "./base44-migration-source";

const SOURCE_SYSTEM = "base44";

/**
 * A hash that can never match a bcrypt-verifiable password. Legacy users imported
 * from Base44 arrive without password material, so we store an unusable sentinel
 * and they must go through password reset to gain access. Never store real hashes
 * from the source, and never write this (or any hash) into reports/ledger.
 */
const UNUSABLE_PASSWORD_HASH = "!base44-migrated-no-login!";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbLike = typeof db | Tx;

// Per-record decisions the admin may supply for conflicting records.
export type ConflictDecision = "use_base44" | "keep_replit" | "skip";

export interface CommitDecisionInput {
  entityType: string;
  sourceId: string;
  decision: ConflictDecision;
  note?: string;
}

type CountMap = Record<string, number>;

interface ActionSummaryEntry {
  inserted: number;
  linked: number;
  updated: number;
  kept: number;
  skipped: number;
  conflicts: number;
}

interface ConflictRecord {
  entityType: string;
  sourceId: string;
  targetTable: string | null;
  targetId: number | null;
  conflictType: string;
  sourceData: Record<string, unknown>;
  targetData: Record<string, unknown>;
  sourceUpdatedAt: Date | null;
  targetUpdatedAt: Date | null;
}

interface LedgerRecord {
  entityType: string;
  sourceId: string;
  targetTable: string;
  targetId: number;
  operation: "insert" | "update" | "link";
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  mappingBefore: Record<string, unknown> | null;
  mappingAfter: Record<string, unknown> | null;
  expectedAfterHash: string;
}

interface MappingSnapshot {
  entityType: string;
  sourceId: string;
  targetTable: string;
  targetId: number;
  status: string;
  sourceHash: string;
  sourceUpdatedAt: Date | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Deterministic projection of a persisted domain row for ledger hashing. Excludes
 * volatile / secret columns (password hashes, auto timestamps) so that a row can
 * be re-hashed later during rollback to detect drift. NEVER include passwordHash.
 */
function projectRow(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "passwordHash") continue;
    if (key === "createdAt" || key === "updatedAt" || key === "joinedAt") continue;
    clone[key] = value instanceof Date ? value.toISOString() : value;
  }
  clone.__table = table;
  return clone;
}

function projectedHash(table: string, row: Record<string, unknown>): string {
  return hashValue(projectRow(table, row));
}

function redactMapping(m: MappingSnapshot | null): Record<string, unknown> | null {
  if (!m) return null;
  return {
    entityType: m.entityType,
    sourceId: m.sourceId,
    targetTable: m.targetTable,
    targetId: m.targetId,
    status: m.status,
    sourceHash: m.sourceHash,
    sourceUpdatedAt: m.sourceUpdatedAt ? m.sourceUpdatedAt.toISOString() : null,
  };
}

function directKeyFor(a: number, b: number): string {
  const [x, y] = a < b ? [a, b] : [b, a];
  return `${x}:${y}`;
}

function messageIdemKey(sourceId: string): string {
  return `base44-msg-${sourceId}`;
}

// ── Analysis / planning engine ────────────────────────────────────────────────

interface PlanContext {
  db: DbLike;
  snapshot: Base44Snapshot;
  decisions: Map<string, ConflictDecision>;
  // Resolved mappings from source id -> target id, keyed by entityType.
  resolved: Map<string, Map<string, number>>;
  // Existing committed mappings (source system) keyed by entityType:sourceId.
  existingMappings: Map<string, MigrationMappingRow>;
  actions: Map<string, ActionSummaryEntry>;
  conflicts: ConflictRecord[];
  nextSyntheticTargetId: number;
  naturalIdentities: Map<string, string>;
}

interface MigrationMappingRow {
  id: number;
  entityType: string;
  sourceId: string;
  targetTable: string;
  targetId: number;
  status: string;
  sourceHash: string;
  sourceUpdatedAt: Date | null;
}

function decisionKey(entityType: string, sourceId: string): string {
  return `${entityType}:${sourceId}`;
}

function bumpAction(ctx: PlanContext, entityType: string, field: keyof ActionSummaryEntry): void {
  let entry = ctx.actions.get(entityType);
  if (!entry) {
    entry = { inserted: 0, linked: 0, updated: 0, kept: 0, skipped: 0, conflicts: 0 };
    ctx.actions.set(entityType, entry);
  }
  entry[field] += 1;
}

function addConflict(ctx: PlanContext, c: ConflictRecord): void {
  ctx.conflicts.push(c);
  bumpAction(ctx, c.entityType, "conflicts");
}

function resolvedId(ctx: PlanContext, entityType: string, sourceId: string): number | undefined {
  return ctx.resolved.get(entityType)?.get(sourceId);
}

function setResolved(ctx: PlanContext, entityType: string, sourceId: string, targetId: number): void {
  let map = ctx.resolved.get(entityType);
  if (!map) {
    map = new Map();
    ctx.resolved.set(entityType, map);
  }
  map.set(sourceId, targetId);
}

function allocateSyntheticTargetId(ctx: PlanContext): number {
  const id = ctx.nextSyntheticTargetId;
  ctx.nextSyntheticTargetId -= 1;
  return id;
}

function claimNaturalIdentity(
  ctx: PlanContext,
  entityType: string,
  sourceId: string,
  naturalKey: string,
  sourceData: Record<string, unknown>,
  sourceUpdatedAt: Date | null,
): boolean {
  const key = `${entityType}:${naturalKey}`;
  const firstSourceId = ctx.naturalIdentities.get(key);
  if (!firstSourceId) {
    ctx.naturalIdentities.set(key, sourceId);
    return true;
  }
  addConflict(ctx, {
    entityType,
    sourceId,
    targetTable: null,
    targetId: null,
    conflictType: "duplicate_natural_identity",
    sourceData,
    targetData: { firstSourceId, naturalKey },
    sourceUpdatedAt,
    targetUpdatedAt: null,
  });
  return false;
}

function canonicalDecisionHash(decisions: Map<string, ConflictDecision>): string {
  return hashValue(
    [...decisions.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, decision]) => ({ key, decision })),
  );
}

// ── Public entry points ───────────────────────────────────────────────────────

export interface DryRunReport {
  runId: number;
  mode: "dry_run";
  status: string;
  snapshotHash: string;
  snapshotId: string | null;
  sourceExportedAt: string | null;
  sourceCounts: CountMap;
  beforeCounts: CountMap;
  afterCounts: CountMap;
  summary: Record<string, unknown>;
  conflicts: Array<Omit<ConflictRecord, "sourceUpdatedAt" | "targetUpdatedAt"> & {
    sourceUpdatedAt: string | null;
    targetUpdatedAt: string | null;
  }>;
}

async function domainCounts(dbc: DbLike): Promise<CountMap> {
  const [u] = await dbc.select({ n: sql<number>`count(*)::int` }).from(usersTable);
  const [p] = await dbc.select({ n: sql<number>`count(*)::int` }).from(profilesTable);
  const [m] = await dbc.select({ n: sql<number>`count(*)::int` }).from(matchesTable);
  const [c] = await dbc.select({ n: sql<number>`count(*)::int` }).from(conversationsTable);
  const [msg] = await dbc.select({ n: sql<number>`count(*)::int` }).from(messagesTable);
  const [sub] = await dbc.select({ n: sql<number>`count(*)::int` }).from(premiumSubscriptionsTable);
  return {
    users: Number(u?.n ?? 0),
    profiles: Number(p?.n ?? 0),
    matches: Number(m?.n ?? 0),
    conversations: Number(c?.n ?? 0),
    messages: Number(msg?.n ?? 0),
    premium: Number(sub?.n ?? 0),
  };
}

async function loadExistingMappings(dbc: DbLike): Promise<Map<string, MigrationMappingRow>> {
  const rows = await dbc
    .select()
    .from(migrationMappingsTable)
    .where(eq(migrationMappingsTable.sourceSystem, SOURCE_SYSTEM));
  const map = new Map<string, MigrationMappingRow>();
  for (const r of rows) {
    map.set(decisionKey(r.entityType, r.sourceId), {
      id: r.id,
      entityType: r.entityType,
      sourceId: r.sourceId,
      targetTable: r.targetTable,
      targetId: r.targetId,
      status: r.status,
      sourceHash: r.sourceHash,
      sourceUpdatedAt: r.sourceUpdatedAt,
    });
  }
  return map;
}

/**
 * Analyze the snapshot against current DB state, producing an action plan,
 * conflicts, and (when apply=true, inside a transaction) actual mutations plus
 * an append-only ledger. Returns everything the caller needs to persist a run.
 */
async function planAndMaybeApply(
  dbc: DbLike,
  snapshot: Base44Snapshot,
  decisions: Map<string, ConflictDecision>,
  apply: boolean,
): Promise<{
  actions: Map<string, ActionSummaryEntry>;
  conflicts: ConflictRecord[];
  ledger: LedgerRecord[];
  mappingsToPersist: MappingSnapshot[];
}> {
  const ctx: PlanContext = {
    db: dbc,
    snapshot,
    decisions,
    resolved: new Map(),
    existingMappings: await loadExistingMappings(dbc),
    actions: new Map(),
    conflicts: [],
    nextSyntheticTargetId: -1,
    naturalIdentities: new Map(),
  };
  const ledger: LedgerRecord[] = [];
  const mappingsToPersist: MappingSnapshot[] = [];

  const recordMapping = (m: MappingSnapshot) => mappingsToPersist.push(m);

  await planUsers(ctx, apply, ledger, recordMapping);
  await planProfiles(ctx, apply, ledger, recordMapping);
  await planMatches(ctx, apply, ledger, recordMapping);
  await planConversations(ctx, apply, ledger, recordMapping);
  await planMessages(ctx, apply, ledger, recordMapping);
  await planPremium(ctx, apply, ledger, recordMapping);

  return { actions: ctx.actions, conflicts: ctx.conflicts, ledger, mappingsToPersist };
}

// Detect whether an existing mapping already points at a live target and whether
// the source is unchanged (idempotent) vs an update.
function existingMappingFor(ctx: PlanContext, entityType: string, sourceId: string): MigrationMappingRow | undefined {
  return ctx.existingMappings.get(decisionKey(entityType, sourceId));
}

// Analyze newer-Replit vs source: returns true when the caller may apply the
// source update, false when it must be treated as a conflict (unless explicitly
// resolved). newerReplit => needs explicit use_base44.
function resolveUpdate(
  ctx: PlanContext,
  entityType: string,
  sourceId: string,
  sourceUpdatedAt: Date | null,
  targetUpdatedAt: Date | null,
): { apply: boolean; conflict: boolean; keep: boolean; skip: boolean } {
  if (sourceUpdatedAt == null) {
    return { apply: false, conflict: false, keep: true, skip: false };
  }
  const newerReplit =
    targetUpdatedAt != null && targetUpdatedAt.getTime() > sourceUpdatedAt.getTime();
  if (!newerReplit) {
    return { apply: true, conflict: false, keep: false, skip: false };
  }
  const decision = ctx.decisions.get(decisionKey(entityType, sourceId));
  if (decision === "use_base44") return { apply: true, conflict: false, keep: false, skip: false };
  if (decision === "keep_replit") return { apply: false, conflict: false, keep: true, skip: false };
  if (decision === "skip") return { apply: false, conflict: false, keep: false, skip: true };
  // No explicit decision on newer Replit data => conflict, never overwrite.
  return { apply: false, conflict: true, keep: false, skip: false };
}

// ── USERS ──────────────────────────────────────────────────────────────────────

async function planUsers(
  ctx: PlanContext,
  apply: boolean,
  ledger: LedgerRecord[],
  recordMapping: (m: MappingSnapshot) => void,
): Promise<void> {
  const seenSourceIds = new Set<string>();
  const seenEmails = new Set<string>();
  for (const u of ctx.snapshot.users) {
    if (seenSourceIds.has(u.id)) {
      addConflict(ctx, {
        entityType: "user",
        sourceId: u.id,
        targetTable: "users",
        targetId: null,
        conflictType: "duplicate_source_identity",
        sourceData: { email: u.email },
        targetData: {},
        sourceUpdatedAt: parseDate(u.updatedAt),
        targetUpdatedAt: null,
      });
      continue;
    }
    seenSourceIds.add(u.id);
    const email = normalizeEmail(u.email);
    if (seenEmails.has(email)) {
      addConflict(ctx, {
        entityType: "user",
        sourceId: u.id,
        targetTable: "users",
        targetId: null,
        conflictType: "duplicate_normalized_email",
        sourceData: { email: u.email },
        targetData: {},
        sourceUpdatedAt: parseDate(u.updatedAt),
        targetUpdatedAt: null,
      });
      continue;
    }
    seenEmails.add(email);
    await planUser(ctx, u, apply, ledger, recordMapping);
  }
}

async function planUser(
  ctx: PlanContext,
  u: Base44User,
  apply: boolean,
  ledger: LedgerRecord[],
  recordMapping: (m: MappingSnapshot) => void,
): Promise<void> {
  const sourceHash = hashValue(u);
  const sourceUpdatedAt = parseDate(u.updatedAt);
  const email = normalizeEmail(u.email);

  // 1. committed source mapping first.
  const mapped = existingMappingFor(ctx, "user", u.id);
  let existingUser: Record<string, unknown> | undefined;
  if (mapped) {
    const [row] = await ctx.db.select().from(usersTable).where(eq(usersTable.id, mapped.targetId)).limit(1);
    if (row) existingUser = row as Record<string, unknown>;
  }
  // 2. normalized email match.
  if (!existingUser) {
    const [row] = await ctx.db
      .select()
      .from(usersTable)
      .where(sql`lower(trim(${usersTable.email})) = ${email}`)
      .limit(1);
    if (row) existingUser = row as Record<string, unknown>;
  }

  if (existingUser) {
    const targetId = existingUser.id as number;
    const conflictingMapping = [...ctx.existingMappings.values()].find(
      (candidate) =>
        candidate.entityType === "user"
        && candidate.targetTable === "users"
        && candidate.targetId === targetId
        && candidate.sourceId !== u.id,
    );
    if (conflictingMapping) {
      addConflict(ctx, {
        entityType: "user",
        sourceId: u.id,
        targetTable: "users",
        targetId,
        conflictType: "target_already_mapped",
        sourceData: { email: u.email },
        targetData: { mappedSourceId: conflictingMapping.sourceId },
        sourceUpdatedAt,
        targetUpdatedAt: (existingUser.updatedAt as Date | null) ?? null,
      });
      return;
    }
    setResolved(ctx, "user", u.id, targetId);
    const targetUpdatedAt = (existingUser.updatedAt as Date | null) ?? null;
    const before: MappingSnapshot | null = mapped
      ? {
          entityType: "user",
          sourceId: u.id,
          targetTable: "users",
          targetId,
          status: mapped.status,
          sourceHash: mapped.sourceHash,
          sourceUpdatedAt: mapped.sourceUpdatedAt,
        }
      : null;

    const unchanged =
      mapped != null
      && mapped.sourceHash === sourceHash
      && !(mapped.status === "kept_replit" && ctx.decisions.get(decisionKey("user", u.id)) === "use_base44");
    if (unchanged) {
      bumpAction(ctx, "user", "kept");
      recordMapping({
        entityType: "user",
        sourceId: u.id,
        targetTable: "users",
        targetId,
        status: mapped!.status,
        sourceHash,
        sourceUpdatedAt,
      });
      return;
    }

    const decision = resolveUpdate(ctx, "user", u.id, sourceUpdatedAt, targetUpdatedAt);
    if (decision.conflict) {
      addConflict(ctx, {
        entityType: "user",
        sourceId: u.id,
        targetTable: "users",
        targetId,
        conflictType: "newer_replit",
        sourceData: { email: u.email, name: u.name },
        targetData: { email: existingUser.email, updatedAt: targetUpdatedAt?.toISOString() ?? null },
        sourceUpdatedAt,
        targetUpdatedAt,
      });
      return;
    }
    if (decision.skip) {
      bumpAction(ctx, "user", "skipped");
      return;
    }
    if (decision.keep) {
      // Link only (no overwrite). Never elevate role automatically.
      bumpAction(ctx, mapped ? "user" : "user", mapped ? "kept" : "linked");
      const status = mapped ? "kept_replit" : "linked";
      const after: MappingSnapshot = {
        entityType: "user",
        sourceId: u.id,
        targetTable: "users",
        targetId,
        status,
        sourceHash,
        sourceUpdatedAt,
      };
      recordMapping(after);
      if (apply) {
        ledger.push({
          entityType: "user",
          sourceId: u.id,
          targetTable: "users",
          targetId,
          operation: "link",
          beforeData: projectRow("users", existingUser),
          afterData: projectRow("users", existingUser),
          mappingBefore: redactMapping(before),
          mappingAfter: redactMapping(after),
          expectedAfterHash: projectedHash("users", existingUser),
        });
      }
      return;
    }

    // apply === use_base44: update non-privileged fields, never elevate to admin.
    const updates: Record<string, unknown> = {
      name: u.name,
      isProfileComplete: u.isProfileComplete ?? existingUser.isProfileComplete,
      isPremium: u.isPremium ?? existingUser.isPremium,
    };
    if (sourceUpdatedAt) updates.updatedAt = sourceUpdatedAt;
    // Restriction may be applied but never removed silently; only set if source restricts.
    if (u.isRestricted) {
      updates.isRestricted = true;
      updates.restrictionReason = u.restrictionReason ?? existingUser.restrictionReason ?? null;
    }
    bumpAction(ctx, "user", "updated");
    let afterRow: Record<string, unknown> = { ...existingUser, ...updates };
    if (apply) {
      const [updated] = await ctx.db
        .update(usersTable)
        .set(updates)
        .where(eq(usersTable.id, targetId))
        .returning();
      afterRow = updated as Record<string, unknown>;
    }
    const after: MappingSnapshot = {
      entityType: "user",
      sourceId: u.id,
      targetTable: "users",
      targetId,
      status: "updated",
      sourceHash,
      sourceUpdatedAt,
    };
    recordMapping(after);
    if (apply) {
      ledger.push({
        entityType: "user",
        sourceId: u.id,
        targetTable: "users",
        targetId,
        operation: "update",
        beforeData: projectRow("users", existingUser),
        afterData: projectRow("users", afterRow),
        mappingBefore: redactMapping(before),
        mappingAfter: redactMapping(after),
        expectedAfterHash: projectedHash("users", afterRow),
      });
    }
    return;
  }

  // 3. Import new legacy user. Unusable password; never admin automatically.
  const role = u.role === "admin" ? "user" : u.role ?? "user";
  bumpAction(ctx, "user", "inserted");
  let newRow: Record<string, unknown> = {
    email,
    passwordHash: UNUSABLE_PASSWORD_HASH,
    name: u.name,
    role,
    isProfileComplete: u.isProfileComplete ?? false,
    isPremium: u.isPremium ?? false,
    isRestricted: u.isRestricted ?? false,
    restrictionReason: u.restrictionReason ?? null,
    createdAt: parseDate(u.createdAt) ?? sourceUpdatedAt ?? new Date(),
    updatedAt: sourceUpdatedAt ?? parseDate(u.createdAt) ?? new Date(),
  };
  let targetId = allocateSyntheticTargetId(ctx);
  if (apply) {
    const [inserted] = await ctx.db.insert(usersTable).values(newRow as any).returning();
    newRow = inserted as Record<string, unknown>;
    targetId = inserted.id;
  }
  setResolved(ctx, "user", u.id, targetId);
  const after: MappingSnapshot = {
    entityType: "user",
    sourceId: u.id,
    targetTable: "users",
    targetId,
    status: "migrated",
    sourceHash,
    sourceUpdatedAt,
  };
  recordMapping(after);
  if (apply) {
    ledger.push({
      entityType: "user",
      sourceId: u.id,
      targetTable: "users",
      targetId,
      operation: "insert",
      beforeData: null,
      afterData: projectRow("users", newRow),
      mappingBefore: null,
      mappingAfter: redactMapping(after),
      expectedAfterHash: projectedHash("users", newRow),
    });
  }
}

// ── PROFILES ────────────────────────────────────────────────────────────────

async function planProfiles(
  ctx: PlanContext,
  apply: boolean,
  ledger: LedgerRecord[],
  recordMapping: (m: MappingSnapshot) => void,
): Promise<void> {
  const seen = new Set<string>();
  for (const p of ctx.snapshot.profiles) {
    if (seen.has(p.id)) {
      addConflict(ctx, {
        entityType: "profile",
        sourceId: p.id,
        targetTable: "profiles",
        targetId: null,
        conflictType: "duplicate_source_identity",
        sourceData: { userId: p.userId },
        targetData: {},
        sourceUpdatedAt: parseDate(p.updatedAt),
        targetUpdatedAt: null,
      });
      continue;
    }
    seen.add(p.id);
    await planProfile(ctx, p, apply, ledger, recordMapping);
  }
}

async function planProfile(
  ctx: PlanContext,
  p: Base44Profile,
  apply: boolean,
  ledger: LedgerRecord[],
  recordMapping: (m: MappingSnapshot) => void,
): Promise<void> {
  const userTargetId = resolvedId(ctx, "user", p.userId);
  if (userTargetId == null) {
    addConflict(ctx, {
      entityType: "profile",
      sourceId: p.id,
      targetTable: "profiles",
      targetId: null,
      conflictType: "missing_dependency",
      sourceData: { userId: p.userId },
      targetData: {},
      sourceUpdatedAt: parseDate(p.updatedAt),
      targetUpdatedAt: null,
    });
    return;
  }
  const sourceHash = hashValue(p);
  const sourceUpdatedAt = parseDate(p.updatedAt);
  if (!claimNaturalIdentity(
    ctx,
    "profile",
    p.id,
    `user:${userTargetId}`,
    { userId: p.userId },
    sourceUpdatedAt,
  )) {
    return;
  }
  const mapped = existingMappingFor(ctx, "profile", p.id);

  // Profiles are 1:1 by userId (unique). Natural identity = userId.
  const [existing] = await ctx.db.select().from(profilesTable).where(eq(profilesTable.userId, userTargetId)).limit(1);

  const values: Record<string, unknown> = {
    userId: userTargetId,
    name: p.name ?? "",
    age: p.age ?? null,
    bio: p.bio ?? null,
    occupation: p.occupation ?? null,
    height: p.height ?? null,
    gender: p.gender ?? null,
    lookingFor: p.lookingFor ?? null,
    relationshipGoal: p.relationshipGoal ?? null,
    primaryLanguage: p.primaryLanguage ?? null,
    otherLanguages: p.otherLanguages ?? [],
    learningLanguages: p.learningLanguages ?? [],
    country: p.country ?? null,
    city: p.city ?? null,
    countriesOfInterest: p.countriesOfInterest ?? [],
    culturalInterests: p.culturalInterests ?? [],
    interests: p.interests ?? [],
    travelGoals: p.travelGoals ?? null,
  };
  if (p.longDistanceOpenness !== undefined) values.longDistanceOpenness = p.longDistanceOpenness;
  if (p.relocationOpenness !== undefined) values.relocationOpenness = p.relocationOpenness;
  if (p.communicationPreferences !== undefined) values.communicationPreferences = p.communicationPreferences;
  if (p.preferredMinAge !== undefined) values.preferredMinAge = p.preferredMinAge;
  if (p.preferredMaxAge !== undefined) values.preferredMaxAge = p.preferredMaxAge;
  if (p.preferredGender !== undefined) values.preferredGender = p.preferredGender;
  if (p.voiceIntroUrl !== undefined) values.voiceIntroUrl = p.voiceIntroUrl;
  if (p.isVerified !== undefined) values.isVerified = p.isVerified;
  if (p.verificationStatus !== undefined) values.verificationStatus = p.verificationStatus;
  if (p.discoveryEnabled !== undefined) values.discoveryEnabled = p.discoveryEnabled;
  if (p.globalDiscovery !== undefined) values.globalDiscovery = p.globalDiscovery;
  if (p.completionPercent !== undefined) values.completionPercent = p.completionPercent;
  if (sourceUpdatedAt) values.updatedAt = sourceUpdatedAt;

  if (existing) {
    const targetId = (existing as Record<string, unknown>).id as number;
    setResolved(ctx, "profile", p.id, targetId);
    const before: MappingSnapshot | null = mapped
      ? {
          entityType: "profile",
          sourceId: p.id,
          targetTable: "profiles",
          targetId,
          status: mapped.status,
          sourceHash: mapped.sourceHash,
          sourceUpdatedAt: mapped.sourceUpdatedAt,
        }
      : null;
    const unchanged =
      mapped != null
      && mapped.sourceHash === sourceHash
      && !(mapped.status === "kept_replit" && ctx.decisions.get(decisionKey("profile", p.id)) === "use_base44");
    if (unchanged) {
      bumpAction(ctx, "profile", "kept");
      recordMapping({
        entityType: "profile",
        sourceId: p.id,
        targetTable: "profiles",
        targetId,
        status: mapped!.status,
        sourceHash,
        sourceUpdatedAt,
      });
      return;
    }
    const targetUpdatedAt = ((existing as Record<string, unknown>).updatedAt as Date | null) ?? null;
    const decision = resolveUpdate(ctx, "profile", p.id, sourceUpdatedAt, targetUpdatedAt);
    if (decision.conflict) {
      addConflict(ctx, {
        entityType: "profile",
        sourceId: p.id,
        targetTable: "profiles",
        targetId,
        conflictType: "newer_replit",
        sourceData: { userId: p.userId },
        targetData: { updatedAt: targetUpdatedAt?.toISOString() ?? null },
        sourceUpdatedAt,
        targetUpdatedAt,
      });
      return;
    }
    if (decision.skip) {
      bumpAction(ctx, "profile", "skipped");
      return;
    }
    if (decision.keep) {
      bumpAction(ctx, "profile", mapped ? "kept" : "linked");
      const after: MappingSnapshot = {
        entityType: "profile",
        sourceId: p.id,
        targetTable: "profiles",
        targetId,
        status: mapped ? "kept_replit" : "linked",
        sourceHash,
        sourceUpdatedAt,
      };
      recordMapping(after);
      if (apply) {
        ledger.push({
          entityType: "profile",
          sourceId: p.id,
          targetTable: "profiles",
          targetId,
          operation: "link",
          beforeData: projectRow("profiles", existing as Record<string, unknown>),
          afterData: projectRow("profiles", existing as Record<string, unknown>),
          mappingBefore: redactMapping(before),
          mappingAfter: redactMapping(after),
          expectedAfterHash: projectedHash("profiles", existing as Record<string, unknown>),
        });
      }
      return;
    }
    // use_base44 update.
    bumpAction(ctx, "profile", "updated");
    let afterRow: Record<string, unknown> = { ...(existing as Record<string, unknown>), ...values };
    if (apply) {
      const [updated] = await ctx.db.update(profilesTable).set(values).where(eq(profilesTable.id, targetId)).returning();
      afterRow = updated as Record<string, unknown>;
    }
    const after: MappingSnapshot = {
      entityType: "profile",
      sourceId: p.id,
      targetTable: "profiles",
      targetId,
      status: "updated",
      sourceHash,
      sourceUpdatedAt,
    };
    recordMapping(after);
    if (apply) {
      ledger.push({
        entityType: "profile",
        sourceId: p.id,
        targetTable: "profiles",
        targetId,
        operation: "update",
        beforeData: projectRow("profiles", existing as Record<string, unknown>),
        afterData: projectRow("profiles", afterRow),
        mappingBefore: redactMapping(before),
        mappingAfter: redactMapping(after),
        expectedAfterHash: projectedHash("profiles", afterRow),
      });
    }
    return;
  }

  // Insert new profile.
  bumpAction(ctx, "profile", "inserted");
  let newRow: Record<string, unknown> = { ...values };
  let targetId = allocateSyntheticTargetId(ctx);
  if (apply) {
    const insertValues = {
      ...values,
      createdAt: parseDate(p.createdAt) ?? sourceUpdatedAt ?? new Date(),
      updatedAt: sourceUpdatedAt ?? parseDate(p.createdAt) ?? new Date(),
    };
    const [inserted] = await ctx.db.insert(profilesTable).values(insertValues as any).returning();
    newRow = inserted as Record<string, unknown>;
    targetId = inserted.id;
  }
  setResolved(ctx, "profile", p.id, targetId);
  const after: MappingSnapshot = {
    entityType: "profile",
    sourceId: p.id,
    targetTable: "profiles",
    targetId,
    status: "migrated",
    sourceHash,
    sourceUpdatedAt,
  };
  recordMapping(after);
  if (apply) {
    ledger.push({
      entityType: "profile",
      sourceId: p.id,
      targetTable: "profiles",
      targetId,
      operation: "insert",
      beforeData: null,
      afterData: projectRow("profiles", newRow),
      mappingBefore: null,
      mappingAfter: redactMapping(after),
      expectedAfterHash: projectedHash("profiles", newRow),
    });
  }
}

// ── MATCHES ───────────────────────────────────────────────────────────────────

async function planMatches(
  ctx: PlanContext,
  apply: boolean,
  ledger: LedgerRecord[],
  recordMapping: (m: MappingSnapshot) => void,
): Promise<void> {
  const seen = new Set<string>();
  for (const m of ctx.snapshot.matches) {
    if (seen.has(m.id)) {
      addConflict(ctx, {
        entityType: "match",
        sourceId: m.id,
        targetTable: "matches",
        targetId: null,
        conflictType: "duplicate_source_identity",
        sourceData: { userId1: m.userId1, userId2: m.userId2 },
        targetData: {},
        sourceUpdatedAt: parseDate(m.updatedAt),
        targetUpdatedAt: null,
      });
      continue;
    }
    seen.add(m.id);
    await planMatch(ctx, m, apply, ledger, recordMapping);
  }
}

async function planMatch(
  ctx: PlanContext,
  m: Base44Match,
  apply: boolean,
  ledger: LedgerRecord[],
  recordMapping: (m: MappingSnapshot) => void,
): Promise<void> {
  const u1 = resolvedId(ctx, "user", m.userId1);
  const u2 = resolvedId(ctx, "user", m.userId2);
  if (u1 == null || u2 == null) {
    addConflict(ctx, {
      entityType: "match",
      sourceId: m.id,
      targetTable: "matches",
      targetId: null,
      conflictType: "missing_dependency",
      sourceData: { userId1: m.userId1, userId2: m.userId2 },
      targetData: {},
      sourceUpdatedAt: parseDate(m.updatedAt),
      targetUpdatedAt: null,
    });
    return;
  }
  const [a, b] = u1 < u2 ? [u1, u2] : [u2, u1];
  const sourceHash = hashValue(m);
  const sourceUpdatedAt = parseDate(m.updatedAt);
  if (!claimNaturalIdentity(
    ctx,
    "match",
    m.id,
    `pair:${a}:${b}`,
    { userId1: m.userId1, userId2: m.userId2 },
    sourceUpdatedAt,
  )) {
    return;
  }
  const mapped = existingMappingFor(ctx, "match", m.id);

  // Natural identity: unordered pair (unique_match_pair on user_id_1,user_id_2).
  const [existing] = await ctx.db
    .select()
    .from(matchesTable)
    .where(and(eq(matchesTable.userId1, a), eq(matchesTable.userId2, b)))
    .limit(1);

  if (existing) {
    const targetId = existing.id;
    setResolved(ctx, "match", m.id, targetId);
    const status = mapped && mapped.sourceHash === sourceHash ? mapped.status : "linked";
    bumpAction(ctx, "match", mapped && mapped.sourceHash === sourceHash ? "kept" : "linked");
    const after: MappingSnapshot = {
      entityType: "match",
      sourceId: m.id,
      targetTable: "matches",
      targetId,
      status,
      sourceHash,
      sourceUpdatedAt,
    };
    recordMapping(after);
    if (apply && !(mapped && mapped.sourceHash === sourceHash)) {
      ledger.push({
        entityType: "match",
        sourceId: m.id,
        targetTable: "matches",
        targetId,
        operation: "link",
        beforeData: projectRow("matches", existing as Record<string, unknown>),
        afterData: projectRow("matches", existing as Record<string, unknown>),
        mappingBefore: redactMapping(
          mapped
            ? {
                entityType: "match",
                sourceId: m.id,
                targetTable: "matches",
                targetId,
                status: mapped.status,
                sourceHash: mapped.sourceHash,
                sourceUpdatedAt: mapped.sourceUpdatedAt,
              }
            : null,
        ),
        mappingAfter: redactMapping(after),
        expectedAfterHash: projectedHash("matches", existing as Record<string, unknown>),
      });
    }
    return;
  }

  bumpAction(ctx, "match", "inserted");
  let newRow: Record<string, unknown> = {
    userId1: a,
    userId2: b,
    conversationId: null,
    createdAt: parseDate(m.createdAt) ?? sourceUpdatedAt ?? new Date(),
    updatedAt: sourceUpdatedAt ?? parseDate(m.createdAt) ?? new Date(),
  };
  let targetId = allocateSyntheticTargetId(ctx);
  if (apply) {
    const [inserted] = await ctx.db.insert(matchesTable).values(newRow as any).returning();
    newRow = inserted as Record<string, unknown>;
    targetId = inserted.id;
  }
  setResolved(ctx, "match", m.id, targetId);
  const after: MappingSnapshot = {
    entityType: "match",
    sourceId: m.id,
    targetTable: "matches",
    targetId,
    status: "migrated",
    sourceHash,
    sourceUpdatedAt,
  };
  recordMapping(after);
  if (apply) {
    ledger.push({
      entityType: "match",
      sourceId: m.id,
      targetTable: "matches",
      targetId,
      operation: "insert",
      beforeData: null,
      afterData: projectRow("matches", newRow),
      mappingBefore: null,
      mappingAfter: redactMapping(after),
      expectedAfterHash: projectedHash("matches", newRow),
    });
  }
}

// ── CONVERSATIONS + PARTICIPANTS ──────────────────────────────────────────────

async function planConversations(
  ctx: PlanContext,
  apply: boolean,
  ledger: LedgerRecord[],
  recordMapping: (m: MappingSnapshot) => void,
): Promise<void> {
  const seen = new Set<string>();
  for (const c of ctx.snapshot.conversations) {
    if (seen.has(c.id)) {
      addConflict(ctx, {
        entityType: "conversation",
        sourceId: c.id,
        targetTable: "conversations",
        targetId: null,
        conflictType: "duplicate_source_identity",
        sourceData: { type: c.type },
        targetData: {},
        sourceUpdatedAt: parseDate(c.updatedAt),
        targetUpdatedAt: null,
      });
      continue;
    }
    seen.add(c.id);
    await planConversation(ctx, c, apply, ledger, recordMapping);
  }
}

async function planConversation(
  ctx: PlanContext,
  c: Base44Conversation,
  apply: boolean,
  ledger: LedgerRecord[],
  recordMapping: (m: MappingSnapshot) => void,
): Promise<void> {
  const participantIds: number[] = [];
  for (const sid of c.participantUserIds) {
    const tid = resolvedId(ctx, "user", sid);
    if (tid == null) {
      addConflict(ctx, {
        entityType: "conversation",
        sourceId: c.id,
        targetTable: "conversations",
        targetId: null,
        conflictType: "missing_dependency",
        sourceData: { participantUserIds: c.participantUserIds },
        targetData: {},
        sourceUpdatedAt: parseDate(c.updatedAt),
        targetUpdatedAt: null,
      });
      return;
    }
    participantIds.push(tid);
  }
  const uniqueParticipants = Array.from(new Set(participantIds));
  const sourceHash = hashValue(c);
  const sourceUpdatedAt = parseDate(c.updatedAt);
  const mapped = existingMappingFor(ctx, "conversation", c.id);

  const isDirect = c.type === "direct" && uniqueParticipants.length === 2;
  const directKey = isDirect ? directKeyFor(uniqueParticipants[0], uniqueParticipants[1]) : null;
  if (
    directKey
    && !claimNaturalIdentity(
      ctx,
      "conversation",
      c.id,
      `direct:${directKey}`,
      { participantUserIds: c.participantUserIds },
      sourceUpdatedAt,
    )
  ) {
    return;
  }

  // Natural identity: directKey for direct; existing mapping for group.
  let existing: Record<string, unknown> | undefined;
  if (isDirect && directKey) {
    const [row] = await ctx.db.select().from(conversationsTable).where(eq(conversationsTable.directKey, directKey)).limit(1);
    if (row) existing = row as Record<string, unknown>;
  } else if (mapped) {
    const [row] = await ctx.db.select().from(conversationsTable).where(eq(conversationsTable.id, mapped.targetId)).limit(1);
    if (row) existing = row as Record<string, unknown>;
  }

  if (existing) {
    const targetId = existing.id as number;
    setResolved(ctx, "conversation", c.id, targetId);
    const status = mapped && mapped.sourceHash === sourceHash ? mapped.status : "linked";
    bumpAction(ctx, "conversation", mapped && mapped.sourceHash === sourceHash ? "kept" : "linked");
    // Ensure participants exist and ledger every inserted membership so a
    // rollback never leaves a pre-existing conversation mutated.
    if (apply) {
      const insertedParticipants = await ctx.db
        .insert(conversationParticipantsTable)
        .values(uniqueParticipants.map((uid) => ({ conversationId: targetId, userId: uid, role: "member" as const })))
        .onConflictDoNothing()
        .returning();
      for (const participant of insertedParticipants) {
        ledger.push({
          entityType: "conversation_participant",
          sourceId: `${c.id}:${participant.userId}`,
          targetTable: "conversation_participants",
          targetId: participant.id,
          operation: "insert",
          beforeData: null,
          afterData: projectRow("conversation_participants", participant as Record<string, unknown>),
          mappingBefore: null,
          mappingAfter: null,
          expectedAfterHash: projectedHash("conversation_participants", participant as Record<string, unknown>),
        });
      }
    }
    const after: MappingSnapshot = {
      entityType: "conversation",
      sourceId: c.id,
      targetTable: "conversations",
      targetId,
      status,
      sourceHash,
      sourceUpdatedAt,
    };
    recordMapping(after);
    if (apply && !(mapped && mapped.sourceHash === sourceHash)) {
      ledger.push({
        entityType: "conversation",
        sourceId: c.id,
        targetTable: "conversations",
        targetId,
        operation: "link",
        beforeData: projectRow("conversations", existing),
        afterData: projectRow("conversations", existing),
        mappingBefore: redactMapping(
          mapped
            ? {
                entityType: "conversation",
                sourceId: c.id,
                targetTable: "conversations",
                targetId,
                status: mapped.status,
                sourceHash: mapped.sourceHash,
                sourceUpdatedAt: mapped.sourceUpdatedAt,
              }
            : null,
        ),
        mappingAfter: redactMapping(after),
        expectedAfterHash: projectedHash("conversations", existing),
      });
    }
    return;
  }

  // Insert new conversation.
  const matchTargetId = c.matchId ? resolvedId(ctx, "match", c.matchId) ?? null : null;
  const ownerTargetId = c.ownerUserId ? resolvedId(ctx, "user", c.ownerUserId) ?? null : null;
  bumpAction(ctx, "conversation", "inserted");
  const values: Record<string, unknown> = {
    type: c.type,
    title: c.title ?? null,
    directKey,
    matchId: matchTargetId,
    ownerId: ownerTargetId,
    translationEnabled: c.translationEnabled ?? false,
    createdAt: parseDate(c.createdAt) ?? sourceUpdatedAt ?? new Date(),
    updatedAt: sourceUpdatedAt ?? parseDate(c.createdAt) ?? new Date(),
  };
  let newRow: Record<string, unknown> = { ...values };
  let targetId = allocateSyntheticTargetId(ctx);
  if (apply) {
    const [inserted] = await ctx.db.insert(conversationsTable).values(values as any).returning();
    newRow = inserted as Record<string, unknown>;
    targetId = inserted.id;
    await ctx.db
      .insert(conversationParticipantsTable)
      .values(
        uniqueParticipants.map((uid) => ({
          conversationId: targetId,
          userId: uid,
          role: uid === ownerTargetId ? ("owner" as const) : ("member" as const),
        })),
      )
      .onConflictDoNothing();
  }
  setResolved(ctx, "conversation", c.id, targetId);
  const after: MappingSnapshot = {
    entityType: "conversation",
    sourceId: c.id,
    targetTable: "conversations",
    targetId,
    status: "migrated",
    sourceHash,
    sourceUpdatedAt,
  };
  recordMapping(after);
  if (apply) {
    ledger.push({
      entityType: "conversation",
      sourceId: c.id,
      targetTable: "conversations",
      targetId,
      operation: "insert",
      beforeData: null,
      afterData: projectRow("conversations", newRow),
      mappingBefore: null,
      mappingAfter: redactMapping(after),
      expectedAfterHash: projectedHash("conversations", newRow),
    });
    // Backfill only after the conversation ledger entry is appended. For a
    // pre-existing match, the dedicated update entry then reverses first.
    if (matchTargetId != null) {
      const [matchBefore] = await ctx.db
        .select()
        .from(matchesTable)
        .where(eq(matchesTable.id, matchTargetId))
        .limit(1);
      const [matchAfter] = await ctx.db
        .update(matchesTable)
        .set({ conversationId: targetId })
        .where(and(eq(matchesTable.id, matchTargetId), sql`${matchesTable.conversationId} is null`))
        .returning();
      if (matchBefore && matchAfter && c.matchId) {
        const insertedMatchLedger = [...ledger]
          .reverse()
          .find((entry) =>
            entry.entityType === "match"
            && entry.sourceId === c.matchId
            && entry.targetId === matchTargetId
            && entry.operation === "insert",
          );
        if (insertedMatchLedger?.afterData) {
          const projectedAfter = projectRow("matches", matchAfter as Record<string, unknown>);
          insertedMatchLedger.afterData = projectedAfter;
          insertedMatchLedger.expectedAfterHash = hashValue(projectedAfter);
        } else {
          ledger.push({
            entityType: "match_conversation",
            sourceId: c.matchId,
            targetTable: "matches",
            targetId: matchTargetId,
            operation: "update",
            beforeData: projectRow("matches", matchBefore as Record<string, unknown>),
            afterData: projectRow("matches", matchAfter as Record<string, unknown>),
            mappingBefore: null,
            mappingAfter: null,
            expectedAfterHash: projectedHash("matches", matchAfter as Record<string, unknown>),
          });
        }
      }
    }
  }
}

// ── MESSAGES ──────────────────────────────────────────────────────────────────

async function planMessages(
  ctx: PlanContext,
  apply: boolean,
  ledger: LedgerRecord[],
  recordMapping: (m: MappingSnapshot) => void,
): Promise<void> {
  const seen = new Set<string>();
  for (const msg of ctx.snapshot.messages) {
    if (seen.has(msg.id)) {
      addConflict(ctx, {
        entityType: "message",
        sourceId: msg.id,
        targetTable: "messages",
        targetId: null,
        conflictType: "duplicate_source_identity",
        sourceData: { conversationId: msg.conversationId },
        targetData: {},
        sourceUpdatedAt: parseDate(msg.updatedAt),
        targetUpdatedAt: null,
      });
      continue;
    }
    seen.add(msg.id);
    await planMessage(ctx, msg, apply, ledger, recordMapping);
  }
}

async function planMessage(
  ctx: PlanContext,
  msg: Base44Message,
  apply: boolean,
  ledger: LedgerRecord[],
  recordMapping: (m: MappingSnapshot) => void,
): Promise<void> {
  const convTargetId = resolvedId(ctx, "conversation", msg.conversationId);
  const senderTargetId = resolvedId(ctx, "user", msg.senderUserId);
  if (convTargetId == null || senderTargetId == null) {
    addConflict(ctx, {
      entityType: "message",
      sourceId: msg.id,
      targetTable: "messages",
      targetId: null,
      conflictType: "missing_dependency",
      sourceData: { conversationId: msg.conversationId, senderUserId: msg.senderUserId },
      targetData: {},
      sourceUpdatedAt: parseDate(msg.updatedAt),
      targetUpdatedAt: null,
    });
    return;
  }
  const sourceHash = hashValue(msg);
  const sourceUpdatedAt = parseDate(msg.updatedAt);
  const idemKey = messageIdemKey(msg.id);
  const mapped = existingMappingFor(ctx, "message", msg.id);

  // Idempotency key is the natural identity for dedup.
  const [existing] = await ctx.db.select().from(messagesTable).where(eq(messagesTable.idempotencyKey, idemKey)).limit(1);
  if (existing) {
    const targetId = existing.id;
    setResolved(ctx, "message", msg.id, targetId);
    bumpAction(ctx, "message", mapped && mapped.sourceHash === sourceHash ? "kept" : "linked");
    const after: MappingSnapshot = {
      entityType: "message",
      sourceId: msg.id,
      targetTable: "messages",
      targetId,
      status: mapped && mapped.sourceHash === sourceHash ? mapped.status : "linked",
      sourceHash,
      sourceUpdatedAt,
    };
    recordMapping(after);
    if (apply && !(mapped && mapped.sourceHash === sourceHash)) {
      ledger.push({
        entityType: "message",
        sourceId: msg.id,
        targetTable: "messages",
        targetId,
        operation: "link",
        beforeData: projectRow("messages", existing as Record<string, unknown>),
        afterData: projectRow("messages", existing as Record<string, unknown>),
        mappingBefore: redactMapping(
          mapped
            ? {
                entityType: "message",
                sourceId: msg.id,
                targetTable: "messages",
                targetId,
                status: mapped.status,
                sourceHash: mapped.sourceHash,
                sourceUpdatedAt: mapped.sourceUpdatedAt,
              }
            : null,
        ),
        mappingAfter: redactMapping(after),
        expectedAfterHash: projectedHash("messages", existing as Record<string, unknown>),
      });
    }
    return;
  }

  bumpAction(ctx, "message", "inserted");
  const values: Record<string, unknown> = {
    conversationId: convTargetId,
    senderId: senderTargetId,
    content: msg.content ?? null,
    contentType: msg.contentType,
    attachmentUrl: msg.attachmentUrl ?? null,
    isDeleted: msg.isDeleted ?? false,
    detectedLanguage: msg.detectedLanguage ?? null,
    reactions: (msg.reactions ?? []).flatMap((reaction) => {
      const targetUserId = resolvedId(ctx, "user", reaction.userId);
      return targetUserId == null ? [] : [{ userId: targetUserId, emoji: reaction.emoji }];
    }),
    idempotencyKey: idemKey,
    createdAt: parseDate(msg.createdAt) ?? sourceUpdatedAt ?? new Date(),
    updatedAt: sourceUpdatedAt ?? parseDate(msg.createdAt) ?? new Date(),
  };
  let newRow: Record<string, unknown> = { ...values };
  let targetId = allocateSyntheticTargetId(ctx);
  if (apply) {
    const [inserted] = await ctx.db.insert(messagesTable).values(values as any).returning();
    newRow = inserted as Record<string, unknown>;
    targetId = inserted.id;
  }
  setResolved(ctx, "message", msg.id, targetId);
  const after: MappingSnapshot = {
    entityType: "message",
    sourceId: msg.id,
    targetTable: "messages",
    targetId,
    status: "migrated",
    sourceHash,
    sourceUpdatedAt,
  };
  recordMapping(after);
  if (apply) {
    ledger.push({
      entityType: "message",
      sourceId: msg.id,
      targetTable: "messages",
      targetId,
      operation: "insert",
      beforeData: null,
      afterData: projectRow("messages", newRow),
      mappingBefore: null,
      mappingAfter: redactMapping(after),
      expectedAfterHash: projectedHash("messages", newRow),
    });
  }
}

// ── PREMIUM ────────────────────────────────────────────────────────────────────

async function planPremium(
  ctx: PlanContext,
  apply: boolean,
  ledger: LedgerRecord[],
  recordMapping: (m: MappingSnapshot) => void,
): Promise<void> {
  const seen = new Set<string>();
  for (const s of ctx.snapshot.premium) {
    if (seen.has(s.id)) {
      addConflict(ctx, {
        entityType: "premium",
        sourceId: s.id,
        targetTable: "premium_subscriptions",
        targetId: null,
        conflictType: "duplicate_source_identity",
        sourceData: { userId: s.userId },
        targetData: {},
        sourceUpdatedAt: parseDate(s.updatedAt),
        targetUpdatedAt: null,
      });
      continue;
    }
    seen.add(s.id);
    await planPremiumRow(ctx, s, apply, ledger, recordMapping);
  }
}

async function planPremiumRow(
  ctx: PlanContext,
  s: Base44Premium,
  apply: boolean,
  ledger: LedgerRecord[],
  recordMapping: (m: MappingSnapshot) => void,
): Promise<void> {
  const userTargetId = resolvedId(ctx, "user", s.userId);
  if (userTargetId == null) {
    addConflict(ctx, {
      entityType: "premium",
      sourceId: s.id,
      targetTable: "premium_subscriptions",
      targetId: null,
      conflictType: "missing_dependency",
      sourceData: { userId: s.userId },
      targetData: {},
      sourceUpdatedAt: parseDate(s.updatedAt),
      targetUpdatedAt: null,
    });
    return;
  }
  const sourceHash = hashValue(s);
  const sourceUpdatedAt = parseDate(s.updatedAt);
  if (!claimNaturalIdentity(
    ctx,
    "premium",
    s.id,
    `user:${userTargetId}`,
    { userId: s.userId },
    sourceUpdatedAt,
  )) {
    return;
  }
  const mapped = existingMappingFor(ctx, "premium", s.id);

  // Subscription identity: one active subscription per user (natural identity = userId).
  const [existing] = await ctx.db
    .select()
    .from(premiumSubscriptionsTable)
    .where(eq(premiumSubscriptionsTable.userId, userTargetId))
    .limit(1);

  const values: Record<string, unknown> = {
    userId: userTargetId,
    planId: s.planId ?? null,
    status: s.status,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd ?? false,
    currentPeriodEnd: parseDate(s.currentPeriodEnd),
    nextBillingDate: parseDate(s.nextBillingDate),
    stripeSubscriptionId: s.stripeSubscriptionId ?? null,
    stripeCustomerId: s.stripeCustomerId ?? null,
    platform: s.platform,
  };
  if (sourceUpdatedAt) values.updatedAt = sourceUpdatedAt;

  if (existing) {
    const targetId = (existing as Record<string, unknown>).id as number;
    setResolved(ctx, "premium", s.id, targetId);
    const before: MappingSnapshot | null = mapped
      ? {
          entityType: "premium",
          sourceId: s.id,
          targetTable: "premium_subscriptions",
          targetId,
          status: mapped.status,
          sourceHash: mapped.sourceHash,
          sourceUpdatedAt: mapped.sourceUpdatedAt,
        }
      : null;
    if (
      mapped
      && mapped.sourceHash === sourceHash
      && !(mapped.status === "kept_replit" && ctx.decisions.get(decisionKey("premium", s.id)) === "use_base44")
    ) {
      bumpAction(ctx, "premium", "kept");
      recordMapping({
        entityType: "premium",
        sourceId: s.id,
        targetTable: "premium_subscriptions",
        targetId,
        status: mapped.status,
        sourceHash,
        sourceUpdatedAt,
      });
      if (apply) {
        await syncPremiumUserFlag(ctx, s.id, userTargetId, s.status === "active", ledger);
      }
      return;
    }
    const targetUpdatedAt = ((existing as Record<string, unknown>).updatedAt as Date | null) ?? null;
    const decision = resolveUpdate(ctx, "premium", s.id, sourceUpdatedAt, targetUpdatedAt);
    if (decision.conflict) {
      addConflict(ctx, {
        entityType: "premium",
        sourceId: s.id,
        targetTable: "premium_subscriptions",
        targetId,
        conflictType: "newer_replit",
        sourceData: { status: s.status },
        targetData: { updatedAt: targetUpdatedAt?.toISOString() ?? null },
        sourceUpdatedAt,
        targetUpdatedAt,
      });
      return;
    }
    if (decision.skip) {
      bumpAction(ctx, "premium", "skipped");
      return;
    }
    if (decision.keep) {
      bumpAction(ctx, "premium", mapped ? "kept" : "linked");
      const after: MappingSnapshot = {
        entityType: "premium",
        sourceId: s.id,
        targetTable: "premium_subscriptions",
        targetId,
        status: mapped ? "kept_replit" : "linked",
        sourceHash,
        sourceUpdatedAt,
      };
      recordMapping(after);
      if (apply) {
        ledger.push({
          entityType: "premium",
          sourceId: s.id,
          targetTable: "premium_subscriptions",
          targetId,
          operation: "link",
          beforeData: projectRow("premium_subscriptions", existing as Record<string, unknown>),
          afterData: projectRow("premium_subscriptions", existing as Record<string, unknown>),
          mappingBefore: redactMapping(before),
          mappingAfter: redactMapping(after),
          expectedAfterHash: projectedHash("premium_subscriptions", existing as Record<string, unknown>),
        });
      }
      return;
    }
    // use_base44 update.
    bumpAction(ctx, "premium", "updated");
    let afterRow: Record<string, unknown> = { ...(existing as Record<string, unknown>), ...values };
    if (apply) {
      const [updated] = await ctx.db
        .update(premiumSubscriptionsTable)
        .set(values)
        .where(eq(premiumSubscriptionsTable.id, targetId))
        .returning();
      afterRow = updated as Record<string, unknown>;
    }
    const after: MappingSnapshot = {
      entityType: "premium",
      sourceId: s.id,
      targetTable: "premium_subscriptions",
      targetId,
      status: "updated",
      sourceHash,
      sourceUpdatedAt,
    };
    recordMapping(after);
    if (apply) {
      ledger.push({
        entityType: "premium",
        sourceId: s.id,
        targetTable: "premium_subscriptions",
        targetId,
        operation: "update",
        beforeData: projectRow("premium_subscriptions", existing as Record<string, unknown>),
        afterData: projectRow("premium_subscriptions", afterRow),
        mappingBefore: redactMapping(before),
        mappingAfter: redactMapping(after),
        expectedAfterHash: projectedHash("premium_subscriptions", afterRow),
      });
      await syncPremiumUserFlag(ctx, s.id, userTargetId, s.status === "active", ledger);
    }
    return;
  }

  bumpAction(ctx, "premium", "inserted");
  let newRow: Record<string, unknown> = { ...values };
  let targetId = allocateSyntheticTargetId(ctx);
  if (apply) {
    const insertValues = {
      ...values,
      createdAt: parseDate(s.createdAt) ?? sourceUpdatedAt ?? new Date(),
      updatedAt: sourceUpdatedAt ?? parseDate(s.createdAt) ?? new Date(),
    };
    const [inserted] = await ctx.db.insert(premiumSubscriptionsTable).values(insertValues as any).returning();
    newRow = inserted as Record<string, unknown>;
    targetId = inserted.id;
  }
  setResolved(ctx, "premium", s.id, targetId);
  const after: MappingSnapshot = {
    entityType: "premium",
    sourceId: s.id,
    targetTable: "premium_subscriptions",
    targetId,
    status: "migrated",
    sourceHash,
    sourceUpdatedAt,
  };
  recordMapping(after);
  if (apply) {
    ledger.push({
      entityType: "premium",
      sourceId: s.id,
      targetTable: "premium_subscriptions",
      targetId,
      operation: "insert",
      beforeData: null,
      afterData: projectRow("premium_subscriptions", newRow),
      mappingBefore: null,
      mappingAfter: redactMapping(after),
      expectedAfterHash: projectedHash("premium_subscriptions", newRow),
    });
    await syncPremiumUserFlag(ctx, s.id, userTargetId, s.status === "active", ledger);
  }
}

async function syncPremiumUserFlag(
  ctx: PlanContext,
  sourceId: string,
  userId: number,
  isPremium: boolean,
  ledger: LedgerRecord[],
): Promise<void> {
  const [before] = await ctx.db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!before || before.isPremium === isPremium) return;
  const [after] = await ctx.db
    .update(usersTable)
    .set({ isPremium })
    .where(eq(usersTable.id, userId))
    .returning();
  ledger.push({
    entityType: "premium_user",
    sourceId,
    targetTable: "users",
    targetId: userId,
    operation: "update",
    beforeData: projectRow("users", before as Record<string, unknown>),
    afterData: projectRow("users", after as Record<string, unknown>),
    mappingBefore: null,
    mappingAfter: null,
    expectedAfterHash: projectedHash("users", after as Record<string, unknown>),
  });
}

// ── Summaries ─────────────────────────────────────────────────────────────────

function summarizeActions(actions: Map<string, ActionSummaryEntry>): Record<string, ActionSummaryEntry> {
  return Object.fromEntries(actions.entries());
}

function serializeConflict(c: ConflictRecord) {
  return {
    entityType: c.entityType,
    sourceId: c.sourceId,
    targetTable: c.targetTable,
    targetId: c.targetId,
    conflictType: c.conflictType,
    sourceData: c.sourceData,
    targetData: c.targetData,
    sourceUpdatedAt: c.sourceUpdatedAt ? c.sourceUpdatedAt.toISOString() : null,
    targetUpdatedAt: c.targetUpdatedAt ? c.targetUpdatedAt.toISOString() : null,
  };
}

// ── DRY RUN ─────────────────────────────────────────────────────────────────

export async function runDryRun(params: {
  actorUserId: number;
  input: Base44SourceInput;
  decisions?: CommitDecisionInput[];
}): Promise<DryRunReport> {
  const snapshot = await resolveBase44Snapshot(params.input);
  const snapshotHash = hashValue(snapshot);
  const sourceCounts = snapshotCounts(snapshot);
  const decisions = new Map<string, ConflictDecision>();
  for (const d of params.decisions ?? []) {
    decisions.set(decisionKey(d.entityType, d.sourceId), d.decision);
  }

  return db.transaction(async (tx) => {
    const beforeCounts = await domainCounts(tx);
    const { actions, conflicts } = await planAndMaybeApply(tx, snapshot, decisions, false);
    // Dry run: never mutate domain data. afterCounts computed from action plan.
    const afterCounts = projectAfterCounts(beforeCounts, actions);
    const summary = {
      actions: summarizeActions(actions),
      conflictCount: conflicts.length,
      mappingStatus: "previewed",
      decisionHash: canonicalDecisionHash(decisions),
    };
    const [run] = await tx
      .insert(migrationRunsTable)
      .values({
        mode: "dry_run",
        status: conflicts.length > 0 ? "conflicted" : "previewed",
        actorUserId: params.actorUserId,
        snapshotHash,
        snapshotId: snapshot.snapshotId ?? null,
        sourceExportedAt: parseDate(snapshot.exportedAt),
        sourceCounts,
        beforeCounts,
        afterCounts,
        summary,
        completedAt: new Date(),
      })
      .returning();

    if (conflicts.length > 0) {
      await tx
        .insert(migrationConflictsTable)
        .values(
          conflicts.map((c) => ({
            runId: run.id,
            entityType: c.entityType,
            sourceId: c.sourceId,
            targetTable: c.targetTable,
            targetId: c.targetId,
            conflictType: c.conflictType,
            sourceData: c.sourceData,
            targetData: c.targetData,
            sourceUpdatedAt: c.sourceUpdatedAt,
            targetUpdatedAt: c.targetUpdatedAt,
          })),
        )
        .onConflictDoNothing();
    }

    return {
      runId: run.id,
      mode: "dry_run" as const,
      status: run.status,
      snapshotHash,
      snapshotId: run.snapshotId,
      sourceExportedAt: run.sourceExportedAt ? run.sourceExportedAt.toISOString() : null,
      sourceCounts,
      beforeCounts,
      afterCounts,
      summary,
      conflicts: conflicts.map(serializeConflict),
    };
  });
}

function projectAfterCounts(before: CountMap, actions: Map<string, ActionSummaryEntry>): CountMap {
  const after = { ...before };
  const map: Record<string, keyof CountMap> = {
    user: "users",
    profile: "profiles",
    match: "matches",
    conversation: "conversations",
    message: "messages",
    premium: "premium",
  };
  for (const [entity, a] of actions.entries()) {
    const col = map[entity];
    if (col) after[col] = (after[col] ?? 0) + a.inserted;
  }
  return after;
}

// ── COMMIT ─────────────────────────────────────────────────────────────────

export interface CommitResult {
  runId: number;
  mode: "commit";
  status: string;
  idempotentReplay: boolean;
  snapshotHash: string;
  beforeCounts: CountMap;
  afterCounts: CountMap;
  summary: Record<string, unknown>;
  conflicts: ReturnType<typeof serializeConflict>[];
}

export async function runCommit(params: {
  actorUserId: number;
  dryRunId: number;
  snapshotHash: string;
  input: Base44SourceInput;
  decisions?: CommitDecisionInput[];
}): Promise<CommitResult> {
  const snapshot = await resolveBase44Snapshot(params.input);
  const snapshotHash = hashValue(snapshot);
  if (snapshotHash !== params.snapshotHash) {
    throw new MigrationError("snapshot_hash_mismatch", "Snapshot hash does not match the supplied hash");
  }

  const decisions = new Map<string, ConflictDecision>();
  for (const d of params.decisions ?? []) {
    decisions.set(decisionKey(d.entityType, d.sourceId), d.decision);
  }

  return db.transaction(async (tx) => {
    // Validate dry run exists and matches this snapshot.
    const [dryRun] = await tx.select().from(migrationRunsTable).where(eq(migrationRunsTable.id, params.dryRunId)).limit(1);
    if (!dryRun || dryRun.mode !== "dry_run") {
      throw new MigrationError("dry_run_not_found", "dryRunId does not reference a dry run");
    }
    if (dryRun.snapshotHash !== snapshotHash) {
      throw new MigrationError("snapshot_hash_mismatch", "Snapshot hash does not match the referenced dry run");
    }
    const dryRunDecisionHash =
      dryRun.summary && typeof dryRun.summary === "object"
        ? (dryRun.summary as Record<string, unknown>).decisionHash
        : null;
    const commitDecisionHash = canonicalDecisionHash(decisions);
    if (dryRunDecisionHash !== commitDecisionHash) {
      throw new MigrationError(
        "decision_plan_mismatch",
        "Conflict decisions do not match the reviewed dry run; create a new dry run with these decisions",
      );
    }

    // Idempotent replay: a prior committed run with same dryRunId + snapshotHash.
    const [prior] = await tx
      .select()
      .from(migrationRunsTable)
      .where(
        and(
          eq(migrationRunsTable.mode, "commit"),
          eq(migrationRunsTable.dryRunId, params.dryRunId),
          eq(migrationRunsTable.snapshotHash, snapshotHash),
          eq(migrationRunsTable.status, "committed"),
        ),
      )
      .limit(1);
    if (prior) {
      const priorConflicts = await tx
        .select()
        .from(migrationConflictsTable)
        .where(eq(migrationConflictsTable.runId, prior.id));
      return {
        runId: prior.id,
        mode: "commit" as const,
        status: prior.status,
        idempotentReplay: true,
        snapshotHash,
        beforeCounts: prior.beforeCounts,
        afterCounts: prior.afterCounts,
        summary: prior.summary,
        conflicts: priorConflicts.map((c) => ({
          entityType: c.entityType,
          sourceId: c.sourceId,
          targetTable: c.targetTable,
          targetId: c.targetId,
          conflictType: c.conflictType,
          sourceData: c.sourceData,
          targetData: c.targetData,
          sourceUpdatedAt: c.sourceUpdatedAt ? c.sourceUpdatedAt.toISOString() : null,
          targetUpdatedAt: c.targetUpdatedAt ? c.targetUpdatedAt.toISOString() : null,
        })),
      };
    }

    const beforeCounts = await domainCounts(tx);
    const preflight = await planAndMaybeApply(tx, snapshot, decisions, false);
    if (preflight.conflicts.length > 0) {
      throw new MigrationError(
        "unresolved_conflicts",
        `Commit blocked by ${preflight.conflicts.length} unresolved migration conflict(s)`,
      );
    }
    const { actions, conflicts, ledger, mappingsToPersist } = await planAndMaybeApply(tx, snapshot, decisions, true);
    if (conflicts.length > 0) {
      throw new MigrationError(
        "concurrent_conflicts",
        `Commit aborted because ${conflicts.length} conflict(s) appeared during reconciliation`,
      );
    }
    const afterCounts = await domainCounts(tx);

    const status = "committed";
    const summary = {
      actions: summarizeActions(actions),
      conflictCount: conflicts.length,
      ledgerEntries: ledger.length,
      mappingStatus: "committed",
    };

    const [run] = await tx
      .insert(migrationRunsTable)
      .values({
        mode: "commit",
        status,
        actorUserId: params.actorUserId,
        dryRunId: params.dryRunId,
        snapshotHash,
        snapshotId: snapshot.snapshotId ?? null,
        sourceExportedAt: parseDate(snapshot.exportedAt),
        sourceCounts: snapshotCounts(snapshot),
        beforeCounts,
        afterCounts,
        summary,
        completedAt: new Date(),
      })
      .returning();

    // Persist mappings (upsert by source unique key).
    for (const m of mappingsToPersist) {
      if (m.targetId < 0) continue;
      const [current] = await tx
        .select()
        .from(migrationMappingsTable)
        .where(
          and(
            eq(migrationMappingsTable.sourceSystem, SOURCE_SYSTEM),
            eq(migrationMappingsTable.entityType, m.entityType),
            eq(migrationMappingsTable.sourceId, m.sourceId),
          ),
        )
        .limit(1);
      if (
        current
        && current.targetTable === m.targetTable
        && current.targetId === m.targetId
        && current.status === m.status
        && current.sourceHash === m.sourceHash
        && (current.sourceUpdatedAt?.getTime() ?? null) === (m.sourceUpdatedAt?.getTime() ?? null)
      ) {
        continue;
      }
      await tx
        .insert(migrationMappingsTable)
        .values({
          sourceSystem: SOURCE_SYSTEM,
          entityType: m.entityType,
          sourceId: m.sourceId,
          targetTable: m.targetTable,
          targetId: m.targetId,
          status: m.status,
          sourceHash: m.sourceHash,
          sourceUpdatedAt: m.sourceUpdatedAt,
          lastRunId: run.id,
        })
        .onConflictDoUpdate({
          target: [
            migrationMappingsTable.sourceSystem,
            migrationMappingsTable.entityType,
            migrationMappingsTable.sourceId,
          ],
          set: {
            targetTable: m.targetTable,
            targetId: m.targetId,
            status: m.status,
            sourceHash: m.sourceHash,
            sourceUpdatedAt: m.sourceUpdatedAt,
            lastRunId: run.id,
            updatedAt: new Date(),
          },
        });
    }

    // Append-only ledger.
    let seq = 0;
    for (const l of ledger) {
      seq += 1;
      await tx
        .insert(migrationLedgerTable)
        .values({
          runId: run.id,
          sequence: seq,
          entityType: l.entityType,
          sourceId: l.sourceId,
          targetTable: l.targetTable,
          targetId: l.targetId,
          operation: l.operation,
          beforeData: l.beforeData,
          afterData: l.afterData,
          mappingBefore: l.mappingBefore,
          mappingAfter: l.mappingAfter,
          expectedAfterHash: l.expectedAfterHash,
        });
    }

    if (conflicts.length > 0) {
      await tx
        .insert(migrationConflictsTable)
        .values(
          conflicts.map((c) => ({
            runId: run.id,
            entityType: c.entityType,
            sourceId: c.sourceId,
            targetTable: c.targetTable,
            targetId: c.targetId,
            conflictType: c.conflictType,
            sourceData: c.sourceData,
            targetData: c.targetData,
            sourceUpdatedAt: c.sourceUpdatedAt,
            targetUpdatedAt: c.targetUpdatedAt,
          })),
        )
        .onConflictDoNothing();
    }

    return {
      runId: run.id,
      mode: "commit" as const,
      status,
      idempotentReplay: false,
      snapshotHash,
      beforeCounts,
      afterCounts,
      summary,
      conflicts: conflicts.map(serializeConflict),
    };
  });
}

// ── ROLLBACK ────────────────────────────────────────────────────────────────

export interface RollbackResult {
  runId: number;
  rollbackRunId: number;
  status: string;
  reversed: number;
  conflicts: Array<{ entityType: string; sourceId: string; reason: string }>;
  beforeCounts: CountMap;
  afterCounts: CountMap;
}

async function fetchTargetRow(tx: Tx, table: string, id: number): Promise<Record<string, unknown> | undefined> {
  switch (table) {
    case "users": {
      const [r] = await tx.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
      return r as Record<string, unknown> | undefined;
    }
    case "profiles": {
      const [r] = await tx.select().from(profilesTable).where(eq(profilesTable.id, id)).limit(1);
      return r as Record<string, unknown> | undefined;
    }
    case "matches": {
      const [r] = await tx.select().from(matchesTable).where(eq(matchesTable.id, id)).limit(1);
      return r as Record<string, unknown> | undefined;
    }
    case "conversations": {
      const [r] = await tx.select().from(conversationsTable).where(eq(conversationsTable.id, id)).limit(1);
      return r as Record<string, unknown> | undefined;
    }
    case "conversation_participants": {
      const [r] = await tx
        .select()
        .from(conversationParticipantsTable)
        .where(eq(conversationParticipantsTable.id, id))
        .limit(1);
      return r as Record<string, unknown> | undefined;
    }
    case "messages": {
      const [r] = await tx.select().from(messagesTable).where(eq(messagesTable.id, id)).limit(1);
      return r as Record<string, unknown> | undefined;
    }
    case "premium_subscriptions": {
      const [r] = await tx.select().from(premiumSubscriptionsTable).where(eq(premiumSubscriptionsTable.id, id)).limit(1);
      return r as Record<string, unknown> | undefined;
    }
    default:
      return undefined;
  }
}

async function deleteTargetRow(tx: Tx, table: string, id: number): Promise<void> {
  switch (table) {
    case "users":
      await tx.delete(usersTable).where(eq(usersTable.id, id));
      return;
    case "profiles":
      await tx.delete(profilesTable).where(eq(profilesTable.id, id));
      return;
    case "matches":
      await tx.delete(matchesTable).where(eq(matchesTable.id, id));
      return;
    case "conversations":
      await tx.delete(conversationsTable).where(eq(conversationsTable.id, id));
      return;
    case "conversation_participants":
      await tx.delete(conversationParticipantsTable).where(eq(conversationParticipantsTable.id, id));
      return;
    case "messages":
      await tx.delete(messagesTable).where(eq(messagesTable.id, id));
      return;
    case "premium_subscriptions":
      await tx.delete(premiumSubscriptionsTable).where(eq(premiumSubscriptionsTable.id, id));
      return;
  }
}

async function restoreTargetRow(tx: Tx, table: string, id: number, beforeData: Record<string, unknown>): Promise<void> {
  // Reconstruct persisted columns from the projected beforeData (drop synthetic keys).
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(beforeData)) {
    if (k === "__table" || k === "id") continue;
    set[k] = v;
  }
  // Ledger JSON serializes Date values to ISO strings. Convert every mutable
  // timestamp back before handing the row to Drizzle's timestamp encoder.
  const timestampFields =
    table === "users"
      ? ["emailVerifiedAt", "ageRequirementAcceptedAt"]
      : table === "premium_subscriptions"
        ? ["currentPeriodEnd", "nextBillingDate"]
        : [];
  for (const key of timestampFields) {
    if (typeof set[key] === "string") set[key] = new Date(set[key] as string);
  }
  switch (table) {
    case "users":
      await tx.update(usersTable).set(set).where(eq(usersTable.id, id));
      return;
    case "profiles":
      await tx.update(profilesTable).set(set).where(eq(profilesTable.id, id));
      return;
    case "matches":
      await tx.update(matchesTable).set(set).where(eq(matchesTable.id, id));
      return;
    case "premium_subscriptions":
      await tx.update(premiumSubscriptionsTable).set(set).where(eq(premiumSubscriptionsTable.id, id));
      return;
    // matches/conversations/messages 'link' operations do not mutate columns; nothing to restore.
  }
}

export async function runRollback(params: { actorUserId: number; runId: number }): Promise<RollbackResult> {
  return db.transaction(async (tx) => {
    const [target] = await tx.select().from(migrationRunsTable).where(eq(migrationRunsTable.id, params.runId)).limit(1);
    if (!target || target.mode !== "commit") {
      throw new MigrationError("run_not_found", "runId does not reference a commit run");
    }
    if (target.status === "rolled_back") {
      throw new MigrationError("already_rolled_back", "run is already rolled back");
    }

    const beforeCounts = await domainCounts(tx);
    const entries = await tx
      .select()
      .from(migrationLedgerTable)
      .where(eq(migrationLedgerTable.runId, params.runId));
    // Process in reverse sequence order.
    entries.sort((a, b) => b.sequence - a.sequence);

    const conflicts: Array<{ entityType: string; sourceId: string; reason: string }> = [];
    let reversed = 0;

    for (const entry of entries) {
      if (entry.reversalStatus === "reversed") continue;
      const current = await fetchTargetRow(tx, entry.targetTable, entry.targetId);
      // Only reverse if the current projected state still matches expectedAfterHash.
      if (!current) {
        // Row already gone (e.g. cascade). Treat as reversed if it was an insert.
        if (entry.operation === "insert") {
          await reverseMapping(tx, entry);
          await tx
            .update(migrationLedgerTable)
            .set({ reversalStatus: "reversed", reversedAt: new Date() })
            .where(eq(migrationLedgerTable.id, entry.id));
          reversed += 1;
        } else {
          conflicts.push({ entityType: entry.entityType, sourceId: entry.sourceId, reason: "target_missing" });
        }
        continue;
      }
      const currentHash = projectedHash(entry.targetTable, current);
      if (currentHash !== entry.expectedAfterHash) {
        // Newer change since commit — never overwrite. Report conflict.
        conflicts.push({ entityType: entry.entityType, sourceId: entry.sourceId, reason: "drifted_since_commit" });
        continue;
      }

      if (entry.operation === "insert") {
        await deleteTargetRow(tx, entry.targetTable, entry.targetId);
      } else if (entry.operation === "update") {
        if (entry.beforeData) {
          await restoreTargetRow(tx, entry.targetTable, entry.targetId, entry.beforeData);
        }
      }
      // 'link' operations left domain rows untouched; only mapping is reversed.
      await reverseMapping(tx, entry);
      await tx
        .update(migrationLedgerTable)
        .set({ reversalStatus: "reversed", reversedAt: new Date() })
        .where(eq(migrationLedgerTable.id, entry.id));
      reversed += 1;
    }

    const afterCounts = await domainCounts(tx);
    const allReversed = conflicts.length === 0;
    const status = allReversed ? "rolled_back" : "conflicted";

    if (allReversed) {
      await tx
        .update(migrationRunsTable)
        .set({ status: "rolled_back", rolledBackAt: new Date() })
        .where(eq(migrationRunsTable.id, params.runId));
    }

    // Record the rollback as its own run for the ledger/audit trail.
    const [rbRun] = await tx
      .insert(migrationRunsTable)
      .values({
        mode: "rollback",
        status,
        actorUserId: params.actorUserId,
        dryRunId: params.runId,
        snapshotHash: target.snapshotHash,
        snapshotId: target.snapshotId,
        sourceExportedAt: target.sourceExportedAt,
        sourceCounts: target.sourceCounts,
        beforeCounts,
        afterCounts,
        summary: { reversed, conflictCount: conflicts.length, conflicts, targetRunId: params.runId },
        completedAt: new Date(),
      })
      .returning();

    return {
      runId: params.runId,
      rollbackRunId: rbRun.id,
      status,
      reversed,
      conflicts,
      beforeCounts,
      afterCounts,
    };
  });
}

async function reverseMapping(tx: Tx, entry: typeof migrationLedgerTable.$inferSelect): Promise<void> {
  const mappingBefore = entry.mappingBefore as Record<string, unknown> | null;
  if (!mappingBefore) {
    // Mapping was created by this entry: delete it.
    await tx
      .delete(migrationMappingsTable)
      .where(
        and(
          eq(migrationMappingsTable.sourceSystem, SOURCE_SYSTEM),
          eq(migrationMappingsTable.entityType, entry.entityType),
          eq(migrationMappingsTable.sourceId, entry.sourceId),
        ),
      );
    return;
  }
  // Restore prior mapping state.
  await tx
    .update(migrationMappingsTable)
    .set({
      targetTable: String(mappingBefore.targetTable),
      targetId: Number(mappingBefore.targetId),
      status: String(mappingBefore.status),
      sourceHash: String(mappingBefore.sourceHash),
      sourceUpdatedAt: mappingBefore.sourceUpdatedAt ? new Date(String(mappingBefore.sourceUpdatedAt)) : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(migrationMappingsTable.sourceSystem, SOURCE_SYSTEM),
        eq(migrationMappingsTable.entityType, entry.entityType),
        eq(migrationMappingsTable.sourceId, entry.sourceId),
      ),
    );
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class MigrationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "MigrationError";
  }
}

// ── Listing / detail / report ──────────────────────────────────────────────────

export async function listRuns(limit: number, offset: number) {
  const rows = await db
    .select()
    .from(migrationRunsTable)
    .orderBy(sql`${migrationRunsTable.startedAt} desc`)
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({
    id: r.id,
    mode: r.mode,
    status: r.status,
    snapshotHash: r.snapshotHash,
    snapshotId: r.snapshotId,
    dryRunId: r.dryRunId,
    sourceCounts: r.sourceCounts,
    beforeCounts: r.beforeCounts,
    afterCounts: r.afterCounts,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    rolledBackAt: r.rolledBackAt,
  }));
}

export async function getRunDetail(runId: number) {
  const [run] = await db.select().from(migrationRunsTable).where(eq(migrationRunsTable.id, runId)).limit(1);
  if (!run) return null;
  const conflicts = await db.select().from(migrationConflictsTable).where(eq(migrationConflictsTable.runId, runId));
  return {
    id: run.id,
    mode: run.mode,
    status: run.status,
    snapshotHash: run.snapshotHash,
    snapshotId: run.snapshotId,
    dryRunId: run.dryRunId,
    sourceCounts: run.sourceCounts,
    beforeCounts: run.beforeCounts,
    afterCounts: run.afterCounts,
    summary: run.summary,
    error: run.error,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    rolledBackAt: run.rolledBackAt,
    conflicts: conflicts.map((c) => ({
      id: c.id,
      entityType: c.entityType,
      sourceId: c.sourceId,
      conflictType: c.conflictType,
      targetTable: c.targetTable,
      targetId: c.targetId,
      sourceData: c.sourceData,
      targetData: c.targetData,
      decision: c.decision,
    })),
  };
}

/**
 * Full report incl. ledger entries. Ledger before/after data is already scrubbed
 * of password hashes by projectRow(); this simply surfaces the stored records.
 */
export async function getRunReport(runId: number) {
  const detail = await getRunDetail(runId);
  if (!detail) return null;
  const ledger = await db
    .select()
    .from(migrationLedgerTable)
    .where(eq(migrationLedgerTable.runId, runId))
    .orderBy(migrationLedgerTable.sequence);
  const mappings = await db
    .select()
    .from(migrationMappingsTable)
    .where(eq(migrationMappingsTable.lastRunId, runId));
  return {
    ...detail,
    mappings: mappings.map((m) => ({
      entityType: m.entityType,
      sourceId: m.sourceId,
      targetTable: m.targetTable,
      targetId: m.targetId,
      status: m.status,
    })),
    ledger: ledger.map((l) => ({
      sequence: l.sequence,
      entityType: l.entityType,
      sourceId: l.sourceId,
      targetTable: l.targetTable,
      targetId: l.targetId,
      operation: l.operation,
      beforeData: l.beforeData,
      afterData: l.afterData,
      mappingBefore: l.mappingBefore,
      mappingAfter: l.mappingAfter,
      expectedAfterHash: l.expectedAfterHash,
      reversalStatus: l.reversalStatus,
    })),
  };
}
