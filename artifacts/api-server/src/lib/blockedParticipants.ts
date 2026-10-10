import {
  blocksTable,
  conversationParticipantsTable,
} from "@workspace/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";

type QueryExecutor = any;

export async function getBlockedUserIds(
  executor: QueryExecutor,
  userId: number,
  candidateIds?: number[],
): Promise<Set<number>> {
  const candidates = candidateIds ? [...new Set(candidateIds.filter((id) => id !== userId))] : null;
  if (candidates?.length === 0) return new Set();
  const rows = await executor.select({
    blockerId: blocksTable.blockerId,
    blockedId: blocksTable.blockedId,
  }).from(blocksTable).where(or(
    and(
      eq(blocksTable.blockerId, userId),
      candidates ? inArray(blocksTable.blockedId, candidates) : undefined,
    ),
    and(
      eq(blocksTable.blockedId, userId),
      candidates ? inArray(blocksTable.blockerId, candidates) : undefined,
    ),
  ));
  return new Set(rows.map((row: { blockerId: number; blockedId: number }) =>
    row.blockerId === userId ? row.blockedId : row.blockerId
  ));
}

export async function hasBlockedPair(executor: QueryExecutor, userIds: number[]): Promise<boolean> {
  const ids = [...new Set(userIds)];
  if (ids.length < 2) return false;
  const [row] = await executor.select({ id: blocksTable.id }).from(blocksTable).where(and(
    inArray(blocksTable.blockerId, ids),
    inArray(blocksTable.blockedId, ids),
  )).limit(1);
  return Boolean(row);
}

export async function lockUserPairs(executor: QueryExecutor, userIds: number[]): Promise<void> {
  const ids = [...new Set(userIds)].sort((a, b) => a - b);
  for (let left = 0; left < ids.length; left += 1) {
    for (let right = left + 1; right < ids.length; right += 1) {
      await executor.execute(sql`select pg_advisory_xact_lock(${ids[left]}, ${ids[right]})`);
    }
  }
}

export async function getConversationAccessPolicy(
  executor: QueryExecutor,
  conversationId: number,
  userId: number,
) {
  const participants = await executor.select().from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.conversationId, conversationId));
  const participant = participants.find((row: { userId: number }) => row.userId === userId) ?? null;
  if (!participant) {
    return { participant: null, participants, blockedUserIds: new Set<number>() };
  }
  const blockedUserIds = await getBlockedUserIds(
    executor,
    userId,
    participants.map((row: { userId: number }) => row.userId),
  );
  return { participant, participants, blockedUserIds };
}