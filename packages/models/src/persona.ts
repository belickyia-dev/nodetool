/**
 * Persona model – publishing identity container.
 *
 * A persona stores a name, avatar, and platform account bindings for social
 * media publishing workflows.
 */

import { eq, desc } from "drizzle-orm";
import { DBModel, createTimeOrderedUuid } from "./base-model.js";
import { getDb } from "./db.js";
import { personas } from "./schema/personas.js";

export interface PlatformAccounts {
  instagram?: string;
  tiktok?: string;
  youtube?: string;
  pinterest?: string;
  pinterestBoardId?: string;
}

export interface PersonaResponse {
  id: string;
  userId: string;
  name: string;
  avatarAssetId: string | null;
  avatarUrl: string | null;
  platformAccounts: PlatformAccounts;
  createdAt: string;
  updatedAt: string;
}

export class Persona extends DBModel {
  static override table = personas;

  declare id: string;
  declare user_id: string;
  declare name: string;
  declare avatar_asset_id: string | null;
  declare platform_accounts: string;
  declare created_at: string;
  declare updated_at: string;

  constructor(data: Record<string, unknown>) {
    super(data);
    const now = new Date().toISOString();
    this.id ??= createTimeOrderedUuid();
    this.name ??= "";
    this.avatar_asset_id ??= null;
    this.platform_accounts ??= "{}";
    this.created_at ??= now;
    this.updated_at ??= now;
  }

  override beforeSave(): void {
    this.updated_at = new Date().toISOString();
  }

  /** Parse the platform_accounts JSON string into a typed object. */
  getPlatformAccounts(): PlatformAccounts {
    try {
      return JSON.parse(this.platform_accounts) as PlatformAccounts;
    } catch {
      return {};
    }
  }

  /** Set platform accounts from a typed object. */
  setPlatformAccounts(accounts: PlatformAccounts): void {
    this.platform_accounts = JSON.stringify(accounts);
  }

  /** Convert to API response format. */
  toResponse(avatarUrl: string | null = null): PersonaResponse {
    return {
      id: this.id,
      userId: this.user_id,
      name: this.name,
      avatarAssetId: this.avatar_asset_id,
      avatarUrl,
      platformAccounts: this.getPlatformAccounts(),
      createdAt: this.created_at,
      updatedAt: this.updated_at
    };
  }

  /** Find a persona by id, scoped to the user. */
  static async find(userId: string, personaId: string): Promise<Persona | null> {
    const persona = await Persona.get<Persona>(personaId);
    if (!persona) return null;
    if (persona.user_id === userId) return persona;
    return null;
  }

  /** List all personas for a user, ordered by most recently updated. */
  static async listByUser(userId: string, limit = 100): Promise<Persona[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(personas)
      .where(eq(personas.user_id, userId))
      .orderBy(desc(personas.updated_at))
      .limit(limit);
    return rows.map((r: Record<string, unknown>) => new Persona(r));
  }
}
