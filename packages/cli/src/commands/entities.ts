/**
 * `nodetool entities` — manage entity library (characters, locations, styles, props).
 *
 *   nodetool entities list                    # list all entities
 *   nodetool entities seed                    # seed from entity-examples.json
 *   nodetool entities seed --file custom.json # seed from custom file
 *   nodetool entities clear                   # remove all entities (keeps assets)
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { Asset } from "@nodetool-ai/models";
import {
  loadAssetStorageConfig,
  createLogger
} from "@nodetool-ai/config";
import { createStorageAdapter, assetObjectKey } from "@nodetool-ai/storage";
import type { EntityKind } from "@nodetool-ai/protocol";

import { asJson, printTable, confirm } from "./output.js";
import { setupLocalDb, LOCAL_USER_ID } from "./local-db.js";

const log = createLogger("nodetool.entities");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../../..");
const DEFAULT_EXAMPLES = resolve(ROOT, "scripts/entity-examples.json");

const ENTITY_METADATA_KEY = "nodetool_entity";

interface EntityMarker {
  kind: EntityKind;
  name: string;
  descriptor: string;
  description?: string;
  tags?: string[];
}

interface EntityExample {
  name: string;
  descriptor: string;
  description?: string;
  tags?: string[];
  image_url: string;
}

interface ExamplesFile {
  locations?: EntityExample[];
  styles?: EntityExample[];
  props?: EntityExample[];
  characters?: EntityExample[];
}

function fail(e: unknown): never {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
}

/** Read entity marker from asset metadata. */
function readEntityMarker(
  metadata: Record<string, unknown> | null | undefined
): EntityMarker | null {
  const raw = metadata?.[ENTITY_METADATA_KEY];
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const kind = typeof obj.kind === "string" ? obj.kind : "";
  if (!["character", "location", "style", "prop"].includes(kind)) return null;
  return {
    kind: kind as EntityKind,
    name: typeof obj.name === "string" ? obj.name : "",
    descriptor: typeof obj.descriptor === "string" ? obj.descriptor : "",
    description:
      typeof obj.description === "string" ? obj.description : undefined,
    tags: Array.isArray(obj.tags)
      ? obj.tags.filter((t): t is string => typeof t === "string")
      : undefined
  };
}

/** Download image from URL and return bytes + content type. */
async function downloadImage(
  url: string
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Detect content type from magic bytes
  let contentType = response.headers.get("content-type") ?? "image/jpeg";
  if (bytes.length >= 8) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) contentType = "image/png";
    else if (bytes[0] === 0xff && bytes[1] === 0xd8) contentType = "image/jpeg";
    else if (bytes[0] === 0x47 && bytes[1] === 0x49) contentType = "image/gif";
    else if (
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    )
      contentType = "image/webp";
  }

  return { bytes, contentType };
}

/** Get file extension from content type. */
function extFromContentType(contentType: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp"
  };
  return map[contentType] ?? "jpg";
}

/** Create an entity from an example definition. */
async function createEntity(
  kind: EntityKind,
  example: EntityExample,
  storageAdapter: ReturnType<typeof createStorageAdapter>
): Promise<Asset> {
  // Download image
  console.log(`  Downloading: ${example.name}...`);
  const { bytes, contentType } = await downloadImage(example.image_url);

  // Create asset record
  const ext = extFromContentType(contentType);
  const fileName = `${example.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.${ext}`;

  const marker: EntityMarker = {
    kind,
    name: example.name,
    descriptor: example.descriptor,
    description: example.description,
    tags: example.tags
  };

  const asset = (await Asset.create({
    user_id: LOCAL_USER_ID,
    name: fileName,
    content_type: contentType,
    size: bytes.byteLength,
    metadata: {
      [ENTITY_METADATA_KEY]: marker
    }
  })) as Asset;

  // Store the file
  const key = assetObjectKey(LOCAL_USER_ID, `${asset.id}.${ext}`);
  await storageAdapter.store(key, bytes, contentType);

  log.info("Created entity", { kind, name: example.name, assetId: asset.id });
  return asset;
}

export function registerEntitiesCommands(program: Command): void {
  const entities = program
    .command("entities")
    .description("Manage entity library (locations, styles, props)");

  entities
    .command("list")
    .description("List all entities")
    .option("--json", "Output as JSON")
    .option("--kind <kind>", "Filter by kind (location, style, prop, character)")
    .action(async (opts: { json?: boolean; kind?: string }) => {
      try {
        await setupLocalDb();

        // Get all assets and filter for entities
        const allAssets = await Asset.allForMigration(LOCAL_USER_ID);
        const entityRows: {
          id: string;
          kind: string;
          name: string;
          descriptor: string;
          tags: string;
        }[] = [];

        for (const asset of allAssets) {
          const marker = readEntityMarker(asset.metadata);
          if (!marker) continue;
          if (opts.kind && marker.kind !== opts.kind) continue;

          entityRows.push({
            id: asset.id,
            kind: marker.kind,
            name: marker.name,
            descriptor:
              marker.descriptor.length > 50
                ? marker.descriptor.slice(0, 47) + "..."
                : marker.descriptor,
            tags: marker.tags?.join(", ") ?? ""
          });
        }

        if (opts.json) {
          asJson(entityRows);
          return;
        }

        if (entityRows.length === 0) {
          console.log("No entities found. Run `nodetool entities seed` to add examples.");
          return;
        }

        printTable(entityRows);
        console.log(`\nTotal: ${entityRows.length} entities`);
      } catch (e) {
        fail(e);
      }
    });

  entities
    .command("seed")
    .description("Seed entity library with example entities")
    .option("--file <path>", "Path to examples JSON file", DEFAULT_EXAMPLES)
    .option("--kind <kind>", "Only seed specific kind (location, style, prop)")
    .option("--yes", "Skip confirmation prompt")
    .action(
      async (opts: { file?: string; kind?: string; yes?: boolean }) => {
        try {
          await setupLocalDb();

          const filePath = resolve(opts.file ?? DEFAULT_EXAMPLES);
          console.log(`Reading examples from: ${filePath}`);

          const content = await readFile(filePath, "utf8");
          const examples: ExamplesFile = JSON.parse(content);

          // Count what we'll create
          const counts: Record<string, number> = {};
          if (!opts.kind || opts.kind === "location") {
            counts.location = examples.locations?.length ?? 0;
          }
          if (!opts.kind || opts.kind === "style") {
            counts.style = examples.styles?.length ?? 0;
          }
          if (!opts.kind || opts.kind === "prop") {
            counts.prop = examples.props?.length ?? 0;
          }

          const total = Object.values(counts).reduce((a, b) => a + b, 0);
          if (total === 0) {
            console.log("No examples to seed.");
            return;
          }

          console.log("\nWill create:");
          for (const [kind, count] of Object.entries(counts)) {
            if (count > 0) console.log(`  ${kind}: ${count}`);
          }
          console.log(`  Total: ${total}\n`);

          if (!opts.yes) {
            const ok = await confirm("Proceed?");
            if (!ok) {
              console.log("Cancelled.");
              return;
            }
          }

          // Initialize storage
          const storageConfig = loadAssetStorageConfig();
          const storageAdapter = createStorageAdapter(storageConfig);

          let created = 0;
          let failed = 0;

          // Seed locations
          if ((!opts.kind || opts.kind === "location") && examples.locations) {
            console.log("\n📍 Seeding locations...");
            for (const ex of examples.locations) {
              try {
                await createEntity("location", ex, storageAdapter);
                created++;
              } catch (err) {
                console.error(`  ❌ Failed: ${ex.name} - ${err}`);
                failed++;
              }
            }
          }

          // Seed styles
          if ((!opts.kind || opts.kind === "style") && examples.styles) {
            console.log("\n🎨 Seeding styles...");
            for (const ex of examples.styles) {
              try {
                await createEntity("style", ex, storageAdapter);
                created++;
              } catch (err) {
                console.error(`  ❌ Failed: ${ex.name} - ${err}`);
                failed++;
              }
            }
          }

          // Seed props
          if ((!opts.kind || opts.kind === "prop") && examples.props) {
            console.log("\n🎭 Seeding props...");
            for (const ex of examples.props) {
              try {
                await createEntity("prop", ex, storageAdapter);
                created++;
              } catch (err) {
                console.error(`  ❌ Failed: ${ex.name} - ${err}`);
                failed++;
              }
            }
          }

          console.log(`\n✅ Done! Created: ${created}, Failed: ${failed}`);
        } catch (e) {
          fail(e);
        }
      }
    );

  entities
    .command("clear")
    .description("Remove all entity markers (keeps underlying assets)")
    .option("--kind <kind>", "Only clear specific kind")
    .option("--yes", "Skip confirmation prompt")
    .action(async (opts: { kind?: string; yes?: boolean }) => {
      try {
        await setupLocalDb();

        const allAssets = await Asset.allForMigration(LOCAL_USER_ID);
        const toUpdate: Asset[] = [];

        for (const asset of allAssets) {
          const marker = readEntityMarker(asset.metadata);
          if (!marker) continue;
          if (opts.kind && marker.kind !== opts.kind) continue;
          toUpdate.push(asset);
        }

        if (toUpdate.length === 0) {
          console.log("No entities to clear.");
          return;
        }

        console.log(`Will remove entity markers from ${toUpdate.length} assets.`);
        console.log("(The underlying image assets will be kept.)\n");

        if (!opts.yes) {
          const ok = await confirm("Proceed?");
          if (!ok) {
            console.log("Cancelled.");
            return;
          }
        }

        for (const asset of toUpdate) {
          const metadata = { ...(asset.metadata ?? {}) };
          delete metadata[ENTITY_METADATA_KEY];
          asset.metadata = metadata;
          await asset.save();
        }

        console.log(`✅ Cleared ${toUpdate.length} entity markers.`);
      } catch (e) {
        fail(e);
      }
    });
}
