import { createHash } from "node:crypto";
import { z } from "zod";

const sourceId = z.union([z.string(), z.number()]).transform(String);
const sourceDate = z.string().datetime({ offset: true }).optional();

const userSchema = z.object({
  id: sourceId,
  email: z.string().trim().email(),
  name: z.string().min(1),
  role: z.enum(["user", "coach", "admin"]).optional(),
  isProfileComplete: z.boolean().optional(),
  isPremium: z.boolean().optional(),
  isRestricted: z.boolean().optional(),
  restrictionReason: z.string().nullable().optional(),
  createdAt: sourceDate,
  updatedAt: sourceDate,
}).passthrough();

const profileSchema = z.object({
  id: sourceId,
  userId: sourceId,
  name: z.string().optional(),
  age: z.number().int().nullable().optional(),
  bio: z.string().nullable().optional(),
  occupation: z.string().nullable().optional(),
  height: z.number().int().nullable().optional(),
  gender: z.string().nullable().optional(),
  lookingFor: z.string().nullable().optional(),
  relationshipGoal: z.string().nullable().optional(),
  primaryLanguage: z.string().nullable().optional(),
  otherLanguages: z.array(z.string()).optional(),
  learningLanguages: z.array(z.string()).optional(),
  country: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  countriesOfInterest: z.array(z.string()).optional(),
  culturalInterests: z.array(z.string()).optional(),
  interests: z.array(z.string()).optional(),
  travelGoals: z.string().nullable().optional(),
  longDistanceOpenness: z.boolean().optional(),
  relocationOpenness: z.boolean().optional(),
  communicationPreferences: z.array(z.string()).optional(),
  preferredMinAge: z.number().int().min(18).max(120).optional(),
  preferredMaxAge: z.number().int().min(18).max(120).optional(),
  preferredGender: z.string().nullable().optional(),
  voiceIntroUrl: z.string().nullable().optional(),
  isVerified: z.boolean().optional(),
  verificationStatus: z.string().optional(),
  discoveryEnabled: z.boolean().optional(),
  globalDiscovery: z.boolean().optional(),
  completionPercent: z.number().int().min(0).max(100).optional(),
  createdAt: sourceDate,
  updatedAt: sourceDate,
}).passthrough();

const matchSchema = z.object({
  id: sourceId,
  userId1: sourceId,
  userId2: sourceId,
  createdAt: sourceDate,
  updatedAt: sourceDate,
}).passthrough();

const conversationSchema = z.object({
  id: sourceId,
  type: z.enum(["direct", "group"]).default("direct"),
  title: z.string().nullable().optional(),
  ownerUserId: sourceId.optional(),
  participantUserIds: z.array(sourceId).min(1),
  matchId: sourceId.optional(),
  translationEnabled: z.boolean().optional(),
  createdAt: sourceDate,
  updatedAt: sourceDate,
}).passthrough();

const messageSchema = z.object({
  id: sourceId,
  conversationId: sourceId,
  senderUserId: sourceId,
  content: z.string().nullable().optional(),
  contentType: z.enum(["text", "image", "audio", "voice", "system"]).default("text"),
  attachmentUrl: z.string().nullable().optional(),
  isDeleted: z.boolean().optional(),
  detectedLanguage: z.string().nullable().optional(),
  reactions: z.array(z.object({
    userId: sourceId,
    emoji: z.string().min(1).max(16),
  })).optional(),
  createdAt: sourceDate,
  updatedAt: sourceDate,
}).passthrough();

const premiumSchema = z.object({
  id: sourceId,
  userId: sourceId,
  planId: z.string().nullable().optional(),
  status: z.enum(["active", "cancelled", "expired", "none"]).default("none"),
  cancelAtPeriodEnd: z.boolean().optional(),
  currentPeriodEnd: sourceDate.nullable(),
  nextBillingDate: sourceDate.nullable(),
  stripeSubscriptionId: z.string().nullable().optional(),
  stripeCustomerId: z.string().nullable().optional(),
  platform: z.enum(["web", "ios", "android"]).default("web"),
  createdAt: sourceDate,
  updatedAt: sourceDate,
}).passthrough();

export const base44SnapshotSchema = z.object({
  snapshotId: z.string().min(1).optional(),
  exportedAt: z.string().datetime({ offset: true }),
  users: z.array(userSchema).default([]),
  profiles: z.array(profileSchema).default([]),
  matches: z.array(matchSchema).default([]),
  conversations: z.array(conversationSchema).default([]),
  messages: z.array(messageSchema).default([]),
  premium: z.array(premiumSchema).default([]),
});

export type Base44Snapshot = z.infer<typeof base44SnapshotSchema>;
export type Base44User = Base44Snapshot["users"][number];
export type Base44Profile = Base44Snapshot["profiles"][number];
export type Base44Match = Base44Snapshot["matches"][number];
export type Base44Conversation = Base44Snapshot["conversations"][number];
export type Base44Message = Base44Snapshot["messages"][number];
export type Base44Premium = Base44Snapshot["premium"][number];

export type Base44SourceInput =
  | { source: "inline"; snapshot: unknown }
  | { source: "configured" };

function stableValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function hashValue(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertConfiguredSourceUrl(raw: string | undefined): URL {
  if (!raw) throw new Error("BASE44_MIGRATION_EXPORT_URL is not configured");
  const url = new URL(raw);
  if (url.protocol !== "https:") {
    throw new Error("BASE44_MIGRATION_EXPORT_URL must use HTTPS");
  }
  return url;
}

async function fetchConfiguredSnapshot(): Promise<unknown> {
  const url = assertConfiguredSourceUrl(process.env.BASE44_MIGRATION_EXPORT_URL);
  const token = process.env.BASE44_MIGRATION_EXPORT_TOKEN;
  if (!token) throw new Error("BASE44_MIGRATION_EXPORT_TOKEN is not configured");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Base44 export endpoint returned ${response.status}`);
  }
  return response.json();
}

export async function resolveBase44Snapshot(input: Base44SourceInput): Promise<Base44Snapshot> {
  const raw = input.source === "configured"
    ? await fetchConfiguredSnapshot()
    : input.snapshot;
  return base44SnapshotSchema.parse(raw);
}

export function snapshotCounts(snapshot: Base44Snapshot): Record<string, number> {
  return {
    users: snapshot.users.length,
    profiles: snapshot.profiles.length,
    matches: snapshot.matches.length,
    conversations: snapshot.conversations.length,
    messages: snapshot.messages.length,
    premium: snapshot.premium.length,
  };
}