import { sqliteTable, text, index } from "drizzle-orm/sqlite-core";

/**
 * A persona: a publishing identity with platform account bindings.
 *
 * Personas let creators manage multiple brand identities across social
 * platforms. Each persona stores a name, avatar reference, and platform
 * account IDs (Zernio account bindings) that can be selected when running
 * publishing workflows.
 */
export const personas = sqliteTable(
  "nodetool_personas",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    name: text("name").notNull().default(""),
    /** Reference to an asset for the avatar image, nullable. */
    avatar_asset_id: text("avatar_asset_id"),
    /**
     * JSON object containing platform account IDs.
     * Structure: { instagram?: string, tiktok?: string, youtube?: string,
     *              pinterest?: string, pinterestBoardId?: string,
     *              twitter?: string, facebook?: string, linkedin?: string }
     */
    platform_accounts: text("platform_accounts").notNull().default("{}"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull()
  },
  (table) => [index("idx_personas_user_id").on(table.user_id)]
);
