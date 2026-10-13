import { db, translationsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { CanonicalLanguageCode } from "./translation-languages";

/**
 * Persist a successful translation without ever replacing an existing completed
 * value. The unique (message, target) constraint and CASE expressions make the
 * first completed provider result authoritative across processes.
 */
export async function persistSuccessfulTranslation(
  messageId: number,
  targetLanguage: CanonicalLanguageCode,
  sourceLanguage: CanonicalLanguageCode | null,
  translatedContent: string,
) {
  const updatedAt = new Date();
  const [row] = await db.insert(translationsTable).values({
    messageId,
    targetLanguage,
    sourceLanguage,
    translatedContent,
    status: "done",
    error: null,
  }).onConflictDoUpdate({
    target: [translationsTable.messageId, translationsTable.targetLanguage],
    set: {
      sourceLanguage: sql`CASE WHEN ${translationsTable.status} = 'done' THEN ${translationsTable.sourceLanguage} ELSE ${sourceLanguage} END`,
      translatedContent: sql`CASE WHEN ${translationsTable.status} = 'done' THEN ${translationsTable.translatedContent} ELSE ${translatedContent} END`,
      status: "done",
      error: sql`CASE WHEN ${translationsTable.status} = 'done' THEN ${translationsTable.error} ELSE NULL END`,
      updatedAt: sql`CASE WHEN ${translationsTable.status} = 'done' THEN ${translationsTable.updatedAt} ELSE ${updatedAt} END`,
    },
  }).returning();
  return row;
}