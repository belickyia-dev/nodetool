// Auto-generated — do not edit manually

import { createNode, Connectable, DslNode } from "../core.js";

// Instagram Trend Analyzer — social.trends.InstagramTrendAnalyzer
export interface InstagramTrendAnalyzerInputs {
  cookies?: Connectable<Record<string, unknown>>;
  hashtags?: Connectable<string[]>;
  days?: Connectable<number>;
  limit?: Connectable<number>;
}

export interface InstagramTrendAnalyzerOutputs {
  output: Record<string, unknown>[];
}

export function instagramTrendAnalyzer(
  inputs: InstagramTrendAnalyzerInputs
): DslNode<InstagramTrendAnalyzerOutputs, "output"> {
  return createNode(
    "social.trends.InstagramTrendAnalyzer",
    inputs as Record<string, unknown>,
    { outputNames: ["output"], defaultOutput: "output" }
  );
}

// TikTok Trend Analyzer — social.trends.TikTokTrendAnalyzer
export interface TikTokTrendAnalyzerInputs {
  cookies?: Connectable<Record<string, unknown>>;
  hashtags?: Connectable<string[]>;
  days?: Connectable<number>;
  limit?: Connectable<number>;
}

export interface TikTokTrendAnalyzerOutputs {
  output: Record<string, unknown>[];
}

export function tikTokTrendAnalyzer(
  inputs: TikTokTrendAnalyzerInputs
): DslNode<TikTokTrendAnalyzerOutputs, "output"> {
  return createNode(
    "social.trends.TikTokTrendAnalyzer",
    inputs as Record<string, unknown>,
    { outputNames: ["output"], defaultOutput: "output" }
  );
}
