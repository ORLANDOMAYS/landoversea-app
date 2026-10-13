# Translation Chat Schema Rollout

LandOverSEA uses Replit-managed PostgreSQL with Drizzle. `lib/db/src/schema/` is the schema source of truth. Replit's supported production path is the Publish flow: it introspects development and production, generates and validates their SQL diff, asks for confirmation of any rename, and applies the approved schema change as part of publishing.

Do not add or run custom production SQL, startup DDL, a deployment-time `db:push`, or a production migration script. `pnpm --filter @workspace/db run push` is development-only.

## Before the first translation-chat publish

1. Confirm the development database is current:
   - Run `pnpm --filter @workspace/db run push`.
   - It should report no remaining schema changes after the development rollout.
2. Run the schema contract and messaging checks:
   - `pnpm --filter @workspace/api-server run test:api`
   - `pnpm --filter @workspace/api-server run test:messaging`
3. Start Publish and review the generated database diff before approving it.
4. The translation-chat portion of the diff must be additive. It should add only these columns:

| Table | Column | Production-compatible definition |
| --- | --- | --- |
| `conversation_participants` | `translation_enabled` | `boolean NOT NULL DEFAULT false` |
| `conversation_participants` | `translation_language` | nullable `text` |
| `messages` | `detection_status` | `text NOT NULL DEFAULT 'unknown'` |
| `messages` | `detected_language_at` | nullable `timestamp with time zone` |
| `messages` | `detection_error` | nullable `text` |
| `translations` | `source_language` | nullable `text` |
| `translations` | `error` | nullable `text` |
| `translations` | `updated_at` | `timestamp with time zone NOT NULL DEFAULT now()` |

The existing `messages.detected_language` column is reused. The existing unique index `translations_message_target_unique` on `(message_id, target_language)` must remain in place.

5. Cancel Publish if the diff proposes dropping or renaming a table/column, removing the translation cache index, making a legacy column newly required without a default, or overwriting production data.
6. Approve the schema diff and API/client release together only after the review is clean.

No production schema action is part of feature development. The user controls the future Publish approval.