/**
 * Remotion HTTP Render Service
 *
 * Exposes a simple HTTP API for rendering Remotion compositions headlessly.
 * NodeTool workflows can call this service to generate videos from templates.
 *
 * Usage:
 *   npx tsx demo/server.ts
 *   # or
 *   npm run server --prefix demo
 *
 * API:
 *   POST /render
 *   {
 *     "template": "HookReveal",
 *     "props": { "beforeUrl": "...", "afterUrl": "...", "hookText": "..." },
 *     "durationInFrames": 90,
 *     "fps": 30,
 *     "width": 1080,
 *     "height": 1920
 *   }
 *   Response: { "videoUrl": "/exports/xxx.mp4", "durationMs": 3000 }
 *
 *   GET /exports/:filename
 *   Serves the rendered video file.
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile, mkdir, readdir, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle, type WebpackOverrideFn } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPORTS_DIR = join(__dirname, "exports");
const PORT = Number(process.env.REMOTION_PORT) || 3333;

// Minimal webpack override to handle TSX properly
const webpackOverride: WebpackOverrideFn = (config) => {
  const existingRules = config.module?.rules ?? [];

  // Update esbuild-loader rules to use tsx loader
  for (const rule of existingRules) {
    if (!rule || typeof rule !== "object") continue;
    const use = (rule as { use?: unknown }).use;
    if (!Array.isArray(use)) continue;
    for (const entry of use) {
      if (!entry || typeof entry !== "object") continue;
      const u = entry as { loader?: string; options?: Record<string, unknown> };
      if (typeof u.loader === "string" && u.loader.includes("esbuild-loader") && u.options) {
        u.options = { ...u.options, loader: "tsx" };
      }
    }
  }

  return config;
};

// Ensure exports directory exists
await mkdir(EXPORTS_DIR, { recursive: true });

// Bundle the Remotion templates (standalone, no web-demo deps)
console.log("Bundling Remotion templates...");
const bundleLocation = await bundle({
  entryPoint: join(__dirname, "src/templates/index.tsx"),
  webpackOverride,
  onProgress: (progress) => {
    if (progress % 25 === 0) console.log(`Bundle progress: ${progress}%`);
  },
});
console.log("Bundle ready at:", bundleLocation);

interface RenderRequest {
  template: string;
  props: Record<string, unknown>;
  durationInFrames?: number;
  fps?: number;
  width?: number;
  height?: number;
  codec?: "h264" | "h265" | "vp8" | "vp9";
}

async function handleRender(body: RenderRequest): Promise<{ videoUrl: string; durationMs: number }> {
  const {
    template,
    props,
    durationInFrames = 90,
    fps = 30,
    width = 1080,
    height = 1920,
    codec = "h264",
  } = body;

  const outputId = randomUUID();
  const outputPath = join(EXPORTS_DIR, `${outputId}.mp4`);

  // Select composition (template must be registered in Root.tsx)
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: template,
    inputProps: props,
  });

  // Override dimensions and duration if specified
  const finalComposition = {
    ...composition,
    width: width ?? composition.width,
    height: height ?? composition.height,
    durationInFrames: durationInFrames ?? composition.durationInFrames,
    fps: fps ?? composition.fps,
  };

  console.log(`Rendering ${template} → ${outputPath}`);
  const startTime = Date.now();

  await renderMedia({
    composition: finalComposition,
    serveUrl: bundleLocation,
    codec,
    outputLocation: outputPath,
    inputProps: props,
  });

  const renderTime = Date.now() - startTime;
  console.log(`Render complete in ${renderTime}ms`);

  return {
    videoUrl: `/exports/${outputId}.mp4`,
    durationMs: Math.round((finalComposition.durationInFrames / finalComposition.fps) * 1000),
  };
}

async function serveExport(filename: string, res: ServerResponse): Promise<void> {
  const filePath = join(EXPORTS_DIR, filename);
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": "video/mp4",
      "Content-Length": data.length,
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "File not found" }));
  }
}

async function listTemplates(): Promise<string[]> {
  // Return available template compositions
  return ["HookReveal"];
}

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // POST /render
    if (req.method === "POST" && url.pathname === "/render") {
      const body = (await parseBody(req)) as RenderRequest;
      const result = await handleRender(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }

    // GET /exports/:filename
    if (req.method === "GET" && url.pathname.startsWith("/exports/")) {
      const filename = url.pathname.slice("/exports/".length);
      await serveExport(filename, res);
      return;
    }

    // GET /templates
    if (req.method === "GET" && url.pathname === "/templates") {
      const templates = await listTemplates();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ templates }));
      return;
    }

    // GET /health
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", bundleReady: true }));
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (e) {
    console.error("Request error:", e);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(e) }));
  }
});

server.listen(PORT, () => {
  console.log(`Remotion render service listening on http://localhost:${PORT}`);
  console.log("Endpoints:");
  console.log("  POST /render - Render a template to video");
  console.log("  GET /exports/:filename - Download rendered video");
  console.log("  GET /templates - List available templates");
  console.log("  GET /health - Health check");
});
