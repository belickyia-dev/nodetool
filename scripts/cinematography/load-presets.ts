/**
 * Cinematography Presets Loader
 *
 * Loads camera, lighting, and effects presets into the vectorstore
 * for RAG-based cinematography direction.
 *
 * Usage:
 *   npx tsx scripts/cinematography/load-presets.ts --provider ollama
 *   npx tsx scripts/cinematography/load-presets.ts --provider openai
 *   npx tsx scripts/cinematography/load-presets.ts --provider jina
 *   npx tsx scripts/cinematography/load-presets.ts --dry-run
 *   npx tsx scripts/cinematography/load-presets.ts --query "dramatic closeup"
 *
 * Providers:
 *   ollama  - Local Ollama with nomic-embed-text (free, requires ollama running)
 *   openai  - OpenAI text-embedding-3-small (requires OPENAI_API_KEY)
 *   jina    - Jina AI embeddings (free tier 1M tokens/month, requires JINA_API_KEY)
 *   gemini  - Google Gemini (requires GEMINI_API_KEY, may have region restrictions)
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Preset {
  id: string;
  name: string;
  tags: string[];
  prompt_fragment: string;
  best_for: string;
  [key: string]: unknown;
}

interface PresetFile {
  collection: string;
  category: string;
  presets: Preset[];
}

const COLLECTION_NAME = "cinematography-presets";

type EmbeddingProvider = "ollama" | "openai" | "jina" | "gemini";

interface ProviderConfig {
  provider: EmbeddingProvider;
  model: string;
  envKey: string;
}

const PROVIDER_CONFIGS: Record<EmbeddingProvider, ProviderConfig> = {
  ollama: { provider: "ollama", model: "nomic-embed-text", envKey: "OLLAMA_API_URL" },
  openai: { provider: "openai", model: "text-embedding-3-small", envKey: "OPENAI_API_KEY" },
  jina: { provider: "jina", model: "jina-embeddings-v3", envKey: "JINA_API_KEY" },
  gemini: { provider: "gemini", model: "gemini-embedding-001", envKey: "GEMINI_API_KEY" },
};

function loadPresetFiles(): PresetFile[] {
  const files = ["camera-presets.json", "lighting-presets.json", "effects-presets.json"];

  return files.map((file) => {
    const path = join(__dirname, file);
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as PresetFile;
  });
}

function presetToDocument(preset: Preset, category: string): string {
  // Create a searchable document from preset fields
  const parts = [
    `[${category.toUpperCase()}] ${preset.name}`,
    `Tags: ${preset.tags.join(", ")}`,
    `Prompt: ${preset.prompt_fragment}`,
    `Best for: ${preset.best_for}`,
  ];

  // Add category-specific fields
  if (category === "camera") {
    const cam = preset as Preset & {
      camera_body?: string;
      lens?: string;
      movement?: string;
    };
    if (cam.camera_body) parts.push(`Camera: ${cam.camera_body}`);
    if (cam.lens) parts.push(`Lens: ${cam.lens}`);
    if (cam.movement) parts.push(`Movement: ${cam.movement}`);
  }

  if (category === "lighting") {
    const light = preset as Preset & { ratio?: string; key_light?: string };
    if (light.key_light) parts.push(`Key light: ${light.key_light}`);
    if (light.ratio) parts.push(`Ratio: ${light.ratio}`);
  }

  if (category === "effects") {
    const fx = preset as Preset & { film_stock?: string; grain?: string };
    if (fx.film_stock) parts.push(`Film stock: ${fx.film_stock}`);
    if (fx.grain) parts.push(`Grain: ${fx.grain}`);
  }

  return parts.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const queryIndex = args.indexOf("--query");
  const queryText = queryIndex !== -1 ? args[queryIndex + 1] : null;
  const providerIndex = args.indexOf("--provider");
  const providerName = (providerIndex !== -1 ? args[providerIndex + 1] : "ollama") as EmbeddingProvider;

  if (!PROVIDER_CONFIGS[providerName]) {
    console.error(`Unknown provider: ${providerName}`);
    console.error("Available: ollama, openai, jina, gemini");
    process.exit(1);
  }

  const config = PROVIDER_CONFIGS[providerName];
  console.log(`Using embedding provider: ${config.provider} (${config.model})`);

  // Initialize models DB for secret access
  const { initDb } = await import("@nodetool-ai/models");
  await initDb();

  // Dynamic import to handle ES modules
  const { getDefaultVectorProvider, ProviderEmbeddingFunction } = await import(
    "@nodetool-ai/vectorstore"
  );

  const vectorProvider = getDefaultVectorProvider();

  // Create embedding function based on provider
  const embeddingFunction = new ProviderEmbeddingFunction({
    provider: config.provider,
    model: config.model,
  });

  // Query mode
  if (queryText) {
    console.log(`\nQuerying "${queryText}" in ${COLLECTION_NAME}...\n`);

    try {
      const collection = await vectorProvider.getCollection({
        name: COLLECTION_NAME,
        embeddingFunction,
      });
      const matches = await collection.query({
        text: queryText,
        topK: 5,
      });

      if (matches.length === 0) {
        console.log("No matches found.");
        return;
      }

      console.log(`Found ${matches.length} matches:\n`);
      for (const match of matches) {
        const score = match.score?.toFixed(3) ?? match.distance.toFixed(3);
        console.log(`--- [${score}] ${match.metadata?.name ?? match.id} ---`);
        console.log(`Category: ${match.metadata?.category}`);
        console.log(`Prompt: ${match.metadata?.prompt_fragment}`);
        console.log(`Tags: ${match.metadata?.tags}`);
        console.log();
      }
    } catch (err) {
      console.error("Query failed. Collection may not exist yet.");
      console.error("Run without --query first to load presets.");
      process.exit(1);
    }

    return;
  }

  // Load mode
  console.log("Loading cinematography presets...\n");

  const presetFiles = loadPresetFiles();
  const allRecords: Array<{
    id: string;
    document: string;
    metadata: Record<string, string | number | boolean | null>;
  }> = [];

  for (const file of presetFiles) {
    console.log(`Processing ${file.category}: ${file.presets.length} presets`);

    for (const preset of file.presets) {
      const document = presetToDocument(preset, file.category);

      allRecords.push({
        id: preset.id,
        document,
        metadata: {
          name: preset.name,
          category: file.category,
          tags: preset.tags.join(","),
          prompt_fragment: preset.prompt_fragment,
          best_for: preset.best_for,
        },
      });
    }
  }

  console.log(`\nTotal presets: ${allRecords.length}`);

  if (dryRun) {
    console.log("\n[DRY RUN] Would create collection and upsert presets.");
    console.log("\nSample records:");
    for (const record of allRecords.slice(0, 3)) {
      console.log(`\n--- ${record.id} ---`);
      console.log(record.document);
    }
    return;
  }

  // Create or get collection
  console.log(`\nCreating/getting collection: ${COLLECTION_NAME}`);

  const collection = await vectorProvider.getOrCreateCollection({
    name: COLLECTION_NAME,
    metadata: {
      embedding_model: config.model,
      embedding_provider: config.provider,
      description: "Cinematography presets for camera, lighting, and effects",
      version: "1.0",
    },
    embeddingFunction,
  });

  // Upsert all records
  console.log("Upserting presets (this may take a moment for embeddings)...");

  await collection.upsert(allRecords);

  const count = await collection.count();
  console.log(`\nDone! Collection now has ${count} documents.`);

  // Test query
  console.log("\nTest query: 'dramatic emotional closeup'");
  const testMatches = await collection.query({
    text: "dramatic emotional closeup",
    topK: 3,
  });

  for (const match of testMatches) {
    const score = match.score?.toFixed(3) ?? match.distance.toFixed(3);
    console.log(`  [${score}] ${match.metadata?.name} (${match.metadata?.category})`);
  }

  await vectorProvider.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
