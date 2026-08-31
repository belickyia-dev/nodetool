import { BaseNode, prop } from "@nodetool-ai/node-sdk";
import { tagAsServer } from "@nodetool-ai/nodes-utils";

interface Cookie {
  name: string;
  value: string;
  domain?: string;
}

interface AnalyzedPost {
  platform: string;
  url: string;
  author: string;
  description: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  hours_ago: number;
  engagement_rate: number;
  velocity: number;
  virality_score: number;
  is_video: boolean;
}

function parseCookies(cookiesInput: unknown): Map<string, string> {
  const cookies = new Map<string, string>();

  if (!cookiesInput) return cookies;

  // Handle array of cookie objects (from browser export)
  if (Array.isArray(cookiesInput)) {
    for (const c of cookiesInput as Cookie[]) {
      if (c.name && c.value) {
        cookies.set(c.name, c.value);
      }
    }
    return cookies;
  }

  // Handle object {name: value}
  if (typeof cookiesInput === "object") {
    for (const [name, value] of Object.entries(
      cookiesInput as Record<string, string>
    )) {
      cookies.set(name, String(value));
    }
    return cookies;
  }

  // Handle cookie string "name=value; name2=value2"
  if (typeof cookiesInput === "string") {
    const parts = cookiesInput.split(";");
    for (const part of parts) {
      const [name, ...valueParts] = part.trim().split("=");
      if (name && valueParts.length > 0) {
        cookies.set(name.trim(), valueParts.join("=").trim());
      }
    }
  }

  return cookies;
}

function cookieHeader(cookies: Map<string, string>): string {
  return Array.from(cookies.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function calculateMetrics(
  views: number,
  likes: number,
  comments: number,
  hoursAgo: number
): { engagementRate: number; velocity: number; viralityScore: number } {
  const engagementRate = views > 0 ? (likes + comments) / views : 0;
  const velocity = hoursAgo > 0 ? views / hoursAgo : views;
  const viralityScore = velocity * engagementRate * 1000;

  return {
    engagementRate: Math.round(engagementRate * 10000) / 10000,
    velocity: Math.round(velocity),
    viralityScore: Math.round(viralityScore * 100) / 100
  };
}

// Instagram API response types
interface InstagramMedia {
  pk?: string;
  id?: string;
  code?: string;
  taken_at?: number;
  user?: { username?: string };
  caption?: { text?: string };
  like_count?: number;
  comment_count?: number;
  play_count?: number;
  view_count?: number;
  media_type?: number; // 1=photo, 2=video
}

interface InstagramHashtagResponse {
  sections?: Array<{
    layout_content?: {
      medias?: Array<{ media?: InstagramMedia }>;
    };
  }>;
  next_max_id?: string;
}

export class InstagramTrendAnalyzerNode extends BaseNode {
  static readonly nodeType = "social.trends.InstagramTrendAnalyzer";
  static readonly title = "Instagram Trend Analyzer";
  static readonly description =
    "Analyze trending Instagram posts by hashtag using cookies. Returns engagement metrics and virality scores.\n    instagram, trends, analytics, hashtags, engagement, cookies";
  static readonly metadataOutputTypes = {
    output: "list[dict[str, any]]"
  };
  static readonly inlineFields = [];
  static readonly inputFields = ["cookies", "hashtags"];

  @prop({
    type: "dict[str, any]",
    default: null,
    title: "Cookies",
    description:
      "Instagram cookies exported from browser (must include sessionid and csrftoken)",
    required: true
  })
  declare cookies: any;

  @prop({
    type: "list[str]",
    default: [],
    title: "Hashtags",
    description: "Hashtags to analyze (without #)",
    required: true
  })
  declare hashtags: any;

  @prop({
    type: "int",
    default: 3,
    title: "Days",
    description: "Only include posts from the last N days"
  })
  declare days: any;

  @prop({
    type: "int",
    default: 50,
    title: "Limit",
    description: "Maximum posts per hashtag"
  })
  declare limit: any;

  async process(): Promise<Record<string, unknown>> {
    const cookieMap = parseCookies(this.cookies);
    const hashtags = (this.hashtags as string[]) ?? [];
    const maxDays = Number(this.days ?? 3);
    const limit = Number(this.limit ?? 50);

    if (!cookieMap.has("sessionid")) {
      throw new Error("Instagram cookies must include 'sessionid'");
    }

    const maxAgeSeconds = maxDays * 24 * 60 * 60;
    const now = Math.floor(Date.now() / 1000);
    const results: AnalyzedPost[] = [];

    for (const hashtag of hashtags) {
      const tag = hashtag.replace(/^#/, "").toLowerCase();

      try {
        const response = await fetch(
          `https://i.instagram.com/api/v1/tags/${encodeURIComponent(tag)}/sections/`,
          {
            method: "POST",
            headers: {
              "User-Agent":
                "Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100)",
              "Content-Type": "application/x-www-form-urlencoded",
              Cookie: cookieHeader(cookieMap),
              "X-CSRFToken": cookieMap.get("csrftoken") ?? ""
            },
            body: `tab=recent&page=0`
          }
        );

        if (!response.ok) {
          console.error(
            `Instagram API error for #${tag}: ${response.status} ${response.statusText}`
          );
          continue;
        }

        const data = (await response.json()) as InstagramHashtagResponse;
        const sections = data.sections ?? [];

        for (const section of sections) {
          const medias = section.layout_content?.medias ?? [];

          for (const item of medias) {
            const media = item.media;
            if (!media) continue;

            const takenAt = media.taken_at ?? 0;
            const age = now - takenAt;
            if (age > maxAgeSeconds) continue;

            const hoursAgo = age / 3600;
            const views =
              media.play_count ?? media.view_count ?? (media.like_count ?? 0) * 10;
            const likes = media.like_count ?? 0;
            const comments = media.comment_count ?? 0;

            const { engagementRate, velocity, viralityScore } = calculateMetrics(
              views,
              likes,
              comments,
              hoursAgo
            );

            results.push({
              platform: "instagram",
              url: `https://instagram.com/p/${media.code}`,
              author: media.user?.username ?? "unknown",
              description: (media.caption?.text ?? "").slice(0, 200),
              views,
              likes,
              comments,
              shares: 0,
              hours_ago: Math.round(hoursAgo * 10) / 10,
              engagement_rate: engagementRate,
              velocity,
              virality_score: viralityScore,
              is_video: media.media_type === 2
            });

            if (results.length >= limit * hashtags.length) break;
          }
        }
      } catch (err) {
        console.error(`Error fetching #${tag}:`, err);
      }
    }

    // Sort by virality score and limit
    results.sort((a, b) => b.virality_score - a.virality_score);
    return { output: results.slice(0, limit) };
  }
}

// TikTok API response types
interface TikTokVideo {
  id?: string;
  desc?: string;
  createTime?: number;
  author?: { uniqueId?: string };
  stats?: {
    playCount?: number;
    diggCount?: number;
    commentCount?: number;
    shareCount?: number;
  };
}

interface TikTokChallengeResponse {
  itemList?: TikTokVideo[];
  cursor?: string;
  hasMore?: boolean;
}

export class TikTokTrendAnalyzerNode extends BaseNode {
  static readonly nodeType = "social.trends.TikTokTrendAnalyzer";
  static readonly title = "TikTok Trend Analyzer";
  static readonly description =
    "Analyze trending TikTok videos by hashtag using cookies. Returns engagement metrics and virality scores.\n    tiktok, trends, analytics, hashtags, engagement, cookies";
  static readonly metadataOutputTypes = {
    output: "list[dict[str, any]]"
  };
  static readonly inlineFields = [];
  static readonly inputFields = ["cookies", "hashtags"];

  @prop({
    type: "dict[str, any]",
    default: null,
    title: "Cookies",
    description:
      "TikTok cookies exported from browser (must include sessionid)",
    required: true
  })
  declare cookies: any;

  @prop({
    type: "list[str]",
    default: [],
    title: "Hashtags",
    description: "Hashtags to analyze (without #)",
    required: true
  })
  declare hashtags: any;

  @prop({
    type: "int",
    default: 3,
    title: "Days",
    description: "Only include posts from the last N days"
  })
  declare days: any;

  @prop({
    type: "int",
    default: 50,
    title: "Limit",
    description: "Maximum videos per hashtag"
  })
  declare limit: any;

  async process(): Promise<Record<string, unknown>> {
    const cookieMap = parseCookies(this.cookies);
    const hashtags = (this.hashtags as string[]) ?? [];
    const maxDays = Number(this.days ?? 3);
    const limit = Number(this.limit ?? 50);

    if (!cookieMap.has("sessionid") && !cookieMap.has("sid_tt")) {
      throw new Error("TikTok cookies must include 'sessionid' or 'sid_tt'");
    }

    const maxAgeSeconds = maxDays * 24 * 60 * 60;
    const now = Math.floor(Date.now() / 1000);
    const results: AnalyzedPost[] = [];

    for (const hashtag of hashtags) {
      const tag = hashtag.replace(/^#/, "").toLowerCase();

      try {
        // TikTok challenge/hashtag API
        const response = await fetch(
          `https://www.tiktok.com/api/challenge/item_list/?challengeName=${encodeURIComponent(tag)}&count=30&cursor=0`,
          {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              Cookie: cookieHeader(cookieMap),
              Referer: `https://www.tiktok.com/tag/${tag}`
            }
          }
        );

        if (!response.ok) {
          console.error(
            `TikTok API error for #${tag}: ${response.status} ${response.statusText}`
          );
          continue;
        }

        const data = (await response.json()) as TikTokChallengeResponse;
        const items = data.itemList ?? [];

        for (const video of items) {
          const createTime = video.createTime ?? 0;
          const age = now - createTime;
          if (age > maxAgeSeconds) continue;

          const hoursAgo = age / 3600;
          const views = video.stats?.playCount ?? 0;
          const likes = video.stats?.diggCount ?? 0;
          const comments = video.stats?.commentCount ?? 0;
          const shares = video.stats?.shareCount ?? 0;

          const { engagementRate, velocity, viralityScore } = calculateMetrics(
            views,
            likes,
            comments,
            hoursAgo
          );

          results.push({
            platform: "tiktok",
            url: `https://www.tiktok.com/@${video.author?.uniqueId}/video/${video.id}`,
            author: video.author?.uniqueId ?? "unknown",
            description: (video.desc ?? "").slice(0, 200),
            views,
            likes,
            comments,
            shares,
            hours_ago: Math.round(hoursAgo * 10) / 10,
            engagement_rate: engagementRate,
            velocity,
            virality_score: viralityScore,
            is_video: true
          });

          if (results.length >= limit * hashtags.length) break;
        }
      } catch (err) {
        console.error(`Error fetching #${tag}:`, err);
      }
    }

    // Sort by virality score and limit
    results.sort((a, b) => b.virality_score - a.virality_score);
    return { output: results.slice(0, limit) };
  }
}

export const SOCIAL_TRENDS_NODES = tagAsServer([
  InstagramTrendAnalyzerNode,
  TikTokTrendAnalyzerNode
]);
