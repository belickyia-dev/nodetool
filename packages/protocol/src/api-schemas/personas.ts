import { z } from "zod";

// ── Platform accounts ────────────────────────────────────────────────────────

export const platformAccounts = z.object({
  instagram: z.string().optional(),
  tiktok: z.string().optional(),
  youtube: z.string().optional(),
  pinterest: z.string().optional(),
  pinterestBoardId: z.string().optional(),
  twitter: z.string().optional(),
  facebook: z.string().optional(),
  linkedin: z.string().optional()
});
export type PlatformAccountsSchema = z.infer<typeof platformAccounts>;

// ── API shapes ───────────────────────────────────────────────────────────────

export const personaResponse = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  avatarAssetId: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  platformAccounts: platformAccounts,
  createdAt: z.string(),
  updatedAt: z.string()
});
export type PersonaResponse = z.infer<typeof personaResponse>;

// ── Input schemas ────────────────────────────────────────────────────────────

export const listPersonasInput = z.object({
  limit: z.number().int().min(1).max(100).default(100),
  cursor: z.string().optional()
});

export const listPersonasOutput = z.object({
  personas: z.array(personaResponse),
  next: z.string().nullable()
});

export const getPersonaInput = z.object({
  id: z.string()
});

export const createPersonaInput = z.object({
  name: z.string().min(1).default("New Persona"),
  avatarAssetId: z.string().nullable().optional(),
  platformAccounts: platformAccounts.optional()
});
export type CreatePersonaInput = z.infer<typeof createPersonaInput>;

export const updatePersonaInput = z.object({
  id: z.string(),
  name: z.string().min(1).optional(),
  avatarAssetId: z.string().nullable().optional(),
  platformAccounts: platformAccounts.optional()
});
export type UpdatePersonaInput = z.infer<typeof updatePersonaInput>;

export const deletePersonaInput = z.object({
  id: z.string()
});

export const deletePersonaOutput = z.object({
  ok: z.literal(true)
});
