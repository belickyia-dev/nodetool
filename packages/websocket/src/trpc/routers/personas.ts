/**
 * Personas router — tRPC.
 *
 * A persona is a publishing identity with platform account bindings for social
 * media publishing workflows. Each persona stores a name, avatar, and platform
 * account IDs (Zernio account bindings).
 *
 * Procedures:
 *   list   (query)    — PersonaResponse[]
 *   get    (query)    — PersonaResponse
 *   create (mutation) — PersonaResponse
 *   update (mutation) — PersonaResponse
 *   delete (mutation) — { ok: true }
 */

import { Persona, Asset } from "@nodetool-ai/models";
import type { Persona as PersonaModel, PersonaResponse } from "@nodetool-ai/models";
import { loadAssetStorageConfig, type StorageConfig } from "@nodetool-ai/config";
import { assetObjectKey, createAssetUrlBuilder } from "@nodetool-ai/storage";
import { getAssetFileName } from "../../lib/asset-paths.js";
import { ApiErrorCode } from "../../error-codes.js";
import { router } from "../index.js";
import { protectedProcedure } from "../middleware.js";
import { throwApiError } from "../error-formatter.js";
import {
  listPersonasInput,
  listPersonasOutput,
  getPersonaInput,
  createPersonaInput,
  updatePersonaInput,
  deletePersonaInput,
  deletePersonaOutput,
  personaResponse
} from "@nodetool-ai/protocol/api-schemas/personas.js";

// Lazily initialized URL builder based on the configured storage backend.
let _storageConfig: StorageConfig | null = null;
let _urlBuilder: ((key: string) => Promise<string>) | null = null;

function getUrlBuilder(): (key: string) => Promise<string> {
  const config = loadAssetStorageConfig();
  if (!_urlBuilder || _storageConfig?.kind !== config.kind) {
    _storageConfig = config;
    _urlBuilder = createAssetUrlBuilder(config);
  }
  return _urlBuilder;
}

/** Resolve an avatar asset ID to a URL, or null if not found. */
async function resolveAvatarUrl(
  userId: string,
  assetId: string | null
): Promise<string | null> {
  if (!assetId) return null;
  const asset = await Asset.find(userId, assetId);
  if (!asset || asset.content_type === "folder") return null;

  const fileName = getAssetFileName(asset.id, asset.content_type);
  if (!fileName) return null;

  try {
    return await getUrlBuilder()(assetObjectKey(userId, fileName));
  } catch {
    return null;
  }
}

async function toPersonaResponse(
  persona: PersonaModel,
  userId: string
): Promise<PersonaResponse> {
  const avatarUrl = await resolveAvatarUrl(userId, persona.avatar_asset_id);
  return persona.toResponse(avatarUrl);
}

export const personasRouter = router({
  list: protectedProcedure
    .input(listPersonasInput)
    .output(listPersonasOutput)
    .query(async ({ ctx, input }) => {
      const personas = await Persona.listByUser(ctx.userId, input.limit);
      const responses = await Promise.all(
        personas.map((p) => toPersonaResponse(p, ctx.userId))
      );
      // For now, no cursor-based pagination — return all up to limit
      return {
        personas: responses,
        next: null
      };
    }),

  get: protectedProcedure
    .input(getPersonaInput)
    .output(personaResponse)
    .query(async ({ ctx, input }) => {
      const persona = await Persona.find(ctx.userId, input.id);
      if (!persona) {
        throwApiError(ApiErrorCode.NOT_FOUND, "Persona not found");
      }
      return toPersonaResponse(persona, ctx.userId);
    }),

  create: protectedProcedure
    .input(createPersonaInput)
    .output(personaResponse)
    .mutation(async ({ ctx, input }) => {
      const persona = await Persona.create<PersonaModel>({
        user_id: ctx.userId,
        name: input.name,
        avatar_asset_id: input.avatarAssetId ?? null,
        platform_accounts: JSON.stringify(input.platformAccounts ?? {})
      });
      return toPersonaResponse(persona, ctx.userId);
    }),

  update: protectedProcedure
    .input(updatePersonaInput)
    .output(personaResponse)
    .mutation(async ({ ctx, input }) => {
      const persona = await Persona.find(ctx.userId, input.id);
      if (!persona) {
        throwApiError(ApiErrorCode.NOT_FOUND, "Persona not found");
      }

      if (input.name !== undefined) {
        persona.name = input.name;
      }
      if (input.avatarAssetId !== undefined) {
        persona.avatar_asset_id = input.avatarAssetId;
      }
      if (input.platformAccounts !== undefined) {
        persona.setPlatformAccounts(input.platformAccounts);
      }

      await persona.save();
      return toPersonaResponse(persona, ctx.userId);
    }),

  delete: protectedProcedure
    .input(deletePersonaInput)
    .output(deletePersonaOutput)
    .mutation(async ({ ctx, input }) => {
      const persona = await Persona.find(ctx.userId, input.id);
      if (!persona) {
        throwApiError(ApiErrorCode.NOT_FOUND, "Persona not found");
      }
      await persona.delete();
      return { ok: true as const };
    })
});
