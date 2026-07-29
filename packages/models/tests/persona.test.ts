/**
 * Tests for the Persona model.
 *
 * Covers: constructor defaults, beforeSave, find (user-scoped), listByUser,
 * platform accounts, toResponse.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ModelObserver } from "../src/base-model.js";
import { initTestDb } from "../src/db.js";
import { Persona, type PlatformAccounts } from "../src/persona.js";

// ── Setup ────────────────────────────────────────────────────────────

async function createPersona(
  userId: string,
  name: string,
  platformAccounts: PlatformAccounts = {}
): Promise<Persona> {
  const persona = await Persona.create<Persona>({
    user_id: userId,
    name,
    platform_accounts: JSON.stringify(platformAccounts)
  });
  return persona;
}

describe("Persona model", () => {
  const testUserId = "test-user-123";

  const mockPlatformAccounts: PlatformAccounts = {
    instagram: "acc_instagram_123",
    tiktok: "acc_tiktok_456",
    youtube: "acc_youtube_789"
  };

  beforeEach(() => {
    initTestDb();
  });

  afterEach(() => {
    ModelObserver.clear();
  });

  // ── Constructor defaults ──────────────────────────────────────────

  it("sets default values", () => {
    const persona = new Persona({ user_id: testUserId });
    expect(persona.id).toBeTruthy();
    expect(persona.name).toBe("");
    expect(persona.avatar_asset_id).toBeNull();
    expect(persona.platform_accounts).toBe("{}");
    expect(persona.created_at).toBeTruthy();
    expect(persona.updated_at).toBeTruthy();
  });

  // ── beforeSave ────────────────────────────────────────────────────

  it("updates updated_at on save", async () => {
    const persona = await createPersona(testUserId, "Test Persona");
    const original = persona.updated_at;
    await new Promise((r) => setTimeout(r, 5));

    persona.name = "Updated Name";
    await persona.save();
    expect(persona.updated_at >= original).toBe(true);
  });

  // ── create ────────────────────────────────────────────────────────

  describe("create", () => {
    it("should create a persona with platform accounts", async () => {
      const persona = await createPersona(testUserId, "Test Creator", mockPlatformAccounts);

      expect(persona).toBeDefined();
      expect(persona.id).toBeDefined();
      expect(persona.name).toBe("Test Creator");
      expect(persona.user_id).toBe(testUserId);
      expect(persona.getPlatformAccounts()).toEqual(mockPlatformAccounts);
    });

    it("should create a persona with empty platform accounts", async () => {
      const persona = await createPersona(testUserId, "Empty Persona", {});

      expect(persona.getPlatformAccounts()).toEqual({});
    });

    it("should create a persona with avatar asset id", async () => {
      const persona = await Persona.create<Persona>({
        user_id: testUserId,
        name: "Avatar Persona",
        avatar_asset_id: "asset-123",
        platform_accounts: "{}"
      });

      expect(persona.avatar_asset_id).toBe("asset-123");
    });
  });

  // ── find (user-scoped) ────────────────────────────────────────────

  describe("find", () => {
    it("should find a persona by id for the correct user", async () => {
      const created = await createPersona(testUserId, "Find Me", mockPlatformAccounts);

      const found = await Persona.find(testUserId, created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.name).toBe("Find Me");
    });

    it("should return null for non-existent id", async () => {
      const found = await Persona.find(testUserId, "non-existent-id");
      expect(found).toBeNull();
    });

    it("should return null when accessing another user's persona", async () => {
      const created = await createPersona(testUserId, "Private", {});

      const found = await Persona.find("other-user", created.id);
      expect(found).toBeNull();
    });
  });

  // ── listByUser ────────────────────────────────────────────────────

  describe("listByUser", () => {
    it("should list all personas for a user", async () => {
      await createPersona(testUserId, "Persona 1", { instagram: "acc1" });
      await createPersona(testUserId, "Persona 2", { tiktok: "acc2" });

      const personas = await Persona.listByUser(testUserId);

      expect(personas).toHaveLength(2);
      expect(personas.map((p) => p.name).sort()).toEqual(["Persona 1", "Persona 2"]);
    });

    it("should return empty array for user with no personas", async () => {
      const personas = await Persona.listByUser("no-personas-user");
      expect(personas).toEqual([]);
    });

    it("should not return personas from other users", async () => {
      await createPersona(testUserId, "My Persona", {});
      await createPersona("other-user", "Other Persona", {});

      const myPersonas = await Persona.listByUser(testUserId);

      expect(myPersonas).toHaveLength(1);
      expect(myPersonas[0].name).toBe("My Persona");
    });

    it("should order by most recently updated", async () => {
      const p1 = await createPersona(testUserId, "First", {});
      await new Promise((r) => setTimeout(r, 5));
      const p2 = await createPersona(testUserId, "Second", {});

      const personas = await Persona.listByUser(testUserId);

      // Second should come first (most recently updated)
      expect(personas[0].id).toBe(p2.id);
      expect(personas[1].id).toBe(p1.id);
    });
  });

  // ── update ────────────────────────────────────────────────────────

  describe("update", () => {
    it("should update persona name", async () => {
      const persona = await createPersona(testUserId, "Original Name", {});

      persona.name = "Updated Name";
      await persona.save();

      const found = await Persona.find(testUserId, persona.id);
      expect(found?.name).toBe("Updated Name");
    });

    it("should update platform accounts", async () => {
      const persona = await createPersona(testUserId, "Test", { instagram: "old_acc" });

      persona.setPlatformAccounts({
        instagram: "new_acc",
        tiktok: "tiktok_acc"
      });
      await persona.save();

      const found = await Persona.find(testUserId, persona.id);
      expect(found?.getPlatformAccounts()).toEqual({
        instagram: "new_acc",
        tiktok: "tiktok_acc"
      });
    });
  });

  // ── delete ────────────────────────────────────────────────────────

  describe("delete", () => {
    it("should delete a persona", async () => {
      const persona = await createPersona(testUserId, "To Delete", {});

      await persona.delete();

      const found = await Persona.find(testUserId, persona.id);
      expect(found).toBeNull();
    });
  });

  // ── toResponse ────────────────────────────────────────────────────

  describe("toResponse", () => {
    it("should convert to API response format", async () => {
      const persona = await Persona.create<Persona>({
        user_id: testUserId,
        name: "Response Test",
        avatar_asset_id: "avatar-123",
        platform_accounts: JSON.stringify(mockPlatformAccounts)
      });

      const response = persona.toResponse();

      expect(response).toMatchObject({
        id: persona.id,
        userId: testUserId,
        name: "Response Test",
        avatarAssetId: "avatar-123",
        avatarUrl: null,
        platformAccounts: mockPlatformAccounts
      });
      expect(response.createdAt).toBeDefined();
      expect(response.updatedAt).toBeDefined();
    });

    it("should include avatarUrl when provided", async () => {
      const persona = await createPersona(testUserId, "Avatar Test", {});

      const response = persona.toResponse("https://example.com/avatar.png");

      expect(response.avatarUrl).toBe("https://example.com/avatar.png");
    });
  });

  // ── getPlatformAccounts ───────────────────────────────────────────

  describe("getPlatformAccounts", () => {
    it("should handle all supported platforms", async () => {
      const allPlatforms: PlatformAccounts = {
        instagram: "ig_acc",
        tiktok: "tt_acc",
        youtube: "yt_acc",
        pinterest: "pin_acc",
        pinterestBoardId: "board_123",
        twitter: "tw_acc",
        facebook: "fb_acc",
        linkedin: "li_acc"
      };

      const persona = await createPersona(testUserId, "All Platforms", allPlatforms);

      const accounts = persona.getPlatformAccounts();
      expect(accounts).toEqual(allPlatforms);
    });

    it("should handle invalid JSON gracefully", () => {
      const persona = new Persona({
        user_id: testUserId,
        platform_accounts: "invalid-json"
      });

      expect(persona.getPlatformAccounts()).toEqual({});
    });
  });
});
