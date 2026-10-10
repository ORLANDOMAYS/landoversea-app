import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "@workspace/db";

type ColumnContract = {
  table_name: string;
  column_name: string;
  is_nullable: "YES" | "NO";
  data_type: string;
  column_default: string | null;
};

test("managed database satisfies the additive translation-chat schema contract", async () => {
  const expected = new Map<string, {
    nullable: "YES" | "NO";
    dataType: string;
    defaultPattern?: RegExp;
  }>([
    ["conversation_participants.translation_enabled", {
      nullable: "NO",
      dataType: "boolean",
      defaultPattern: /false/,
    }],
    ["conversation_participants.translation_language", {
      nullable: "YES",
      dataType: "text",
    }],
    ["messages.detection_status", {
      nullable: "NO",
      dataType: "text",
      defaultPattern: /unknown/,
    }],
    ["messages.detected_language_at", {
      nullable: "YES",
      dataType: "timestamp with time zone",
    }],
    ["messages.detection_error", {
      nullable: "YES",
      dataType: "text",
    }],
    ["translations.source_language", {
      nullable: "YES",
      dataType: "text",
    }],
    ["translations.error", {
      nullable: "YES",
      dataType: "text",
    }],
    ["translations.updated_at", {
      nullable: "NO",
      dataType: "timestamp with time zone",
      defaultPattern: /now\(\)/,
    }],
  ]);

  const columns = await pool.query<ColumnContract>(`
    SELECT table_name, column_name, is_nullable, data_type, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'conversation_participants'
          AND column_name IN ('translation_enabled', 'translation_language'))
        OR
        (table_name = 'messages'
          AND column_name IN ('detection_status', 'detected_language_at', 'detection_error'))
        OR
        (table_name = 'translations'
          AND column_name IN ('source_language', 'error', 'updated_at'))
      )
  `);

  assert.equal(columns.rows.length, expected.size);
  for (const column of columns.rows) {
    const key = `${column.table_name}.${column.column_name}`;
    const contract = expected.get(key);
    assert.ok(contract, `unexpected schema-contract column ${key}`);
    assert.equal(column.is_nullable, contract.nullable, `${key} nullability`);
    assert.equal(column.data_type, contract.dataType, `${key} data type`);
    if (contract.defaultPattern) {
      assert.match(column.column_default ?? "", contract.defaultPattern, `${key} default`);
    } else {
      assert.equal(column.column_default, null, `${key} should not add a default`);
    }
  }

  const cacheIndex = await pool.query<{ indexdef: string }>(`
    SELECT indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'translations'
      AND indexname = 'translations_message_target_unique'
  `);
  assert.equal(cacheIndex.rows.length, 1);
  assert.match(cacheIndex.rows[0].indexdef, /UNIQUE/i);
  assert.match(cacheIndex.rows[0].indexdef, /\(message_id, target_language\)/);
});