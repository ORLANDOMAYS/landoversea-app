import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Immutable links between an identity asserted by an external provider and a
 * local account. Provider subjects, rather than mutable email addresses, are
 * the authority for subsequent sign-ins.
 */
export const externalIdentitiesTable = pgTable(
  "external_identities",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("external_identity_provider_subject_unique").on(
      table.provider,
      table.subject,
    ),
    unique("external_identity_provider_user_unique").on(
      table.provider,
      table.userId,
    ),
  ],
);

export type ExternalIdentity = typeof externalIdentitiesTable.$inferSelect;