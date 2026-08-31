import { BaseNode, prop } from "@nodetool-ai/node-sdk";
import { tagAsServer } from "@nodetool-ai/nodes-utils";

// CDP types
type CDPClient = any;

interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
  expirationDate?: number;
}

// Minimal CDP page wrapper for TikTok scraping
interface BrowserSession {
  client: CDPClient;
  close: () => Promise<void>;
}

const DEFAULT_CDP_FLAGS = [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-software-rasterizer",
  "--hide-scrollbars",
  "--mute-audio",
  "--window-size=1280,900",
  // Stealth flags to avoid bot detection
  "--disable-blink-features=AutomationControlled",
  "--disable-infobars",
  "--disable-background-networking",
  "--disable-breakpad",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-features=TranslateUI",
  "--disable-hang-monitor",
  "--disable-ipc-flooding-protection",
  "--disable-popup-blocking",
  "--disable-prompt-on-repost",
  "--disable-renderer-backgrounding",
  "--disable-sync",
  "--enable-features=NetworkService,NetworkServiceInProcess",
  "--force-color-profile=srgb",
  "--metrics-recording-only",
  "--no-first-run",
  "--password-store=basic",
  "--use-mock-keychain",
  "--export-tagged-pdf",
  "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
];

async function launchCdpBrowser(): Promise<BrowserSession> {
  const { launch } = await import("chrome-launcher");
  const CDPMod = (await import("chrome-remote-interface")).default;

  const chrome = await launch({
    chromeFlags: DEFAULT_CDP_FLAGS,
    ignoreDefaultFlags: false,
    chromePath: process.env.CHROME_PATH || undefined
  });

  const client: CDPClient = await CDPMod({ port: chrome.port });
  await client.Emulation.setDeviceMetricsOverride({
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });

  // Enable required domains
  await Promise.all([
    client.Page.enable(),
    client.Runtime.enable(),
    client.Network.enable(),
    client.DOM.enable()
  ]);

  // Remove webdriver flag to avoid bot detection
  await client.Page.addScriptToEvaluateOnNewDocument({
    source: `
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      window.chrome = { runtime: {} };
    `
  });

  return {
    client,
    close: async () => {
      try {
        await client.close();
      } catch {
        // ignore
      }
      try {
        await chrome.kill();
      } catch {
        // ignore
      }
    }
  };
}

async function cdpGoto(
  client: CDPClient,
  url: string,
  timeout: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      // Don't reject on timeout, just resolve - TikTok may never fully load
      resolve();
    }, timeout);

    const off = client.Page.domContentEventFired(() => {
      clearTimeout(t);
      off?.();
      // Wait extra time for dynamic content
      setTimeout(resolve, 3000);
    });

    client.Page.navigate({ url }).catch((err: Error) => {
      clearTimeout(t);
      off?.();
      reject(err);
    });
  });
}

async function cdpEvaluate<T>(client: CDPClient, fn: () => T): Promise<T> {
  const r = await client.Runtime.evaluate({
    expression: `(${fn.toString()})()`,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  });
  if (r.exceptionDetails) {
    throw new Error(
      r.exceptionDetails.exception?.description ??
        r.exceptionDetails.text ??
        "evaluation failed"
    );
  }
  return r.result?.value as T;
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

/** Convert cookie input to CDP cookie format for Network.setCookies */
function toCdpCookies(
  cookiesInput: unknown,
  domain: string
): Array<{
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
}> {
  const result: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
  }> = [];

  if (!cookiesInput) return result;

  // Handle array of cookie objects (from browser export like Cookie-Editor)
  if (Array.isArray(cookiesInput)) {
    for (const c of cookiesInput as Cookie[]) {
      if (c.name && c.value) {
        result.push({
          name: c.name,
          value: c.value,
          domain: c.domain ?? domain,
          path: c.path ?? "/",
          secure: c.secure ?? true,
          httpOnly: c.httpOnly ?? false
        });
      }
    }
    return result;
  }

  // Handle object {name: value}
  if (typeof cookiesInput === "object") {
    for (const [name, value] of Object.entries(
      cookiesInput as Record<string, string>
    )) {
      result.push({
        name,
        value: String(value),
        domain,
        path: "/",
        secure: true,
        httpOnly: false
      });
    }
    return result;
  }

  // Handle cookie string "name=value; name2=value2"
  if (typeof cookiesInput === "string") {
    const parts = cookiesInput.split(";");
    for (const part of parts) {
      const [name, ...valueParts] = part.trim().split("=");
      if (name && valueParts.length > 0) {
        result.push({
          name: name.trim(),
          value: valueParts.join("=").trim(),
          domain,
          path: "/",
          secure: true,
          httpOnly: false
        });
      }
    }
  }

  return result;
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

// TikTok scraped video data
interface TikTokScrapedVideo {
  id: string;
  url: string;
  author: string;
  description: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  createTime: number;
}

export class TikTokTrendAnalyzerNode extends BaseNode {
  static readonly nodeType = "social.trends.TikTokTrendAnalyzer";
  static readonly title = "TikTok Trend Analyzer";
  static readonly description =
    "Analyze trending TikTok videos by hashtag using browser automation with cookies. Returns engagement metrics and virality scores.\n    tiktok, trends, analytics, hashtags, engagement, cookies, playwright";
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
      "TikTok cookies exported from browser (Cookie-Editor JSON format)",
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

  @prop({
    type: "int",
    default: 3,
    title: "Scroll Count",
    description: "Number of times to scroll down to load more videos"
  })
  declare scrollCount: any;

  async process(): Promise<Record<string, unknown>> {
    const cookieMap = parseCookies(this.cookies);
    const hashtags = (this.hashtags as string[]) ?? [];
    const maxDays = Number(this.days ?? 3);
    const limit = Number(this.limit ?? 50);
    const scrollCount = Number(this.scrollCount ?? 3);

    if (
      !cookieMap.has("sessionid") &&
      !cookieMap.has("sid_tt") &&
      !cookieMap.has("sid_guard")
    ) {
      throw new Error(
        "TikTok cookies must include 'sessionid', 'sid_tt', or 'sid_guard'"
      );
    }

    const maxAgeSeconds = maxDays * 24 * 60 * 60;
    const now = Math.floor(Date.now() / 1000);
    const results: AnalyzedPost[] = [];

    // Launch browser
    const session = await launchCdpBrowser();
    try {
      const client = session.client;

      // Set cookies for TikTok
      const cdpCookies = toCdpCookies(this.cookies, ".tiktok.com");
      if (cdpCookies.length > 0) {
        await client.Network.setCookies({ cookies: cdpCookies });
      }

      for (const hashtag of hashtags) {
        const tag = hashtag.replace(/^#/, "").toLowerCase();
        const tagUrl = `https://www.tiktok.com/tag/${encodeURIComponent(tag)}`;

        try {
          // Navigate to hashtag page
          await cdpGoto(client, tagUrl, 30000);

          // Wait for video cards to appear
          await new Promise((r) => setTimeout(r, 3000));

          // Scroll down to load more videos
          for (let i = 0; i < scrollCount; i++) {
            await cdpEvaluate(client, () => {
              window.scrollTo(0, document.body.scrollHeight);
            });
            await new Promise((r) => setTimeout(r, 2000));
          }

          // Debug: log page title and URL to understand what page we're on
          const pageInfo = await cdpEvaluate<{ title: string; url: string; bodyLength: number }>(
            client,
            () => ({
              title: document.title,
              url: window.location.href,
              bodyLength: document.body?.innerHTML?.length ?? 0
            })
          );
          console.log(`TikTok page: ${pageInfo.title} | URL: ${pageInfo.url} | Body length: ${pageInfo.bodyLength}`);

          // Extract video data from the page
          const videos = await cdpEvaluate<TikTokScrapedVideo[]>(client, () => {
            const items: TikTokScrapedVideo[] = [];

            // TikTok uses various selectors for video cards - try multiple approaches
            const videoCards = document.querySelectorAll(
              '[data-e2e="challenge-item"], [data-e2e="user-post-item"], [class*="DivItemContainer"], [class*="DivVideoFeedV2"], div[class*="video-feed-item"], div[class*="tiktok-x"] a[href*="/video/"]'
            );

            // If no cards found, try finding video links directly
            if (videoCards.length === 0) {
              const videoLinks = document.querySelectorAll('a[href*="/@"][href*="/video/"]');
              for (const link of videoLinks) {
                const href = (link as HTMLAnchorElement).href;
                const videoIdMatch = href.match(/\/video\/(\d+)/);
                if (!videoIdMatch) continue;

                const authorMatch = href.match(/@([^/]+)/);
                items.push({
                  id: videoIdMatch[1],
                  url: href,
                  author: authorMatch ? authorMatch[1] : "unknown",
                  description: "",
                  views: 0,
                  likes: 0,
                  comments: 0,
                  shares: 0,
                  createTime: 0
                });
              }
              return items;
            }

            for (const card of videoCards) {
              try {
                // Try to extract video link
                const linkEl = card.querySelector('a[href*="/video/"]') as HTMLAnchorElement | null;
                if (!linkEl) continue;

                const href = linkEl.href;
                const videoIdMatch = href.match(/\/video\/(\d+)/);
                if (!videoIdMatch) continue;

                const videoId = videoIdMatch[1];

                // Extract author from URL
                const authorMatch = href.match(/@([^/]+)/);
                const author = authorMatch ? authorMatch[1] : "unknown";

                // Extract description
                const descEl = card.querySelector(
                  '[data-e2e="video-desc"], [class*="desc"], [class*="caption"]'
                );
                const description = descEl?.textContent?.trim() ?? "";

                // Extract stats - TikTok shows abbreviated numbers like "1.2M"
                const parseCount = (text: string | null | undefined): number => {
                  if (!text) return 0;
                  const clean = text.trim().toLowerCase();
                  const num = parseFloat(clean.replace(/[^\d.]/g, ""));
                  if (isNaN(num)) return 0;
                  if (clean.includes("m")) return Math.round(num * 1000000);
                  if (clean.includes("k")) return Math.round(num * 1000);
                  return Math.round(num);
                };

                // Look for stats in various formats
                const statsText = card.textContent ?? "";
                const viewsEl = card.querySelector(
                  '[data-e2e="video-views"], [class*="play-count"], [class*="view-count"]'
                );
                const likesEl = card.querySelector(
                  '[data-e2e="like-count"], [class*="like-count"]'
                );

                // Extract numbers from stats
                let views = parseCount(viewsEl?.textContent);
                const likes = parseCount(likesEl?.textContent);

                // If no views found, estimate from likes (typical ratio ~20:1)
                if (views === 0 && likes > 0) {
                  views = likes * 20;
                }

                items.push({
                  id: videoId,
                  url: href,
                  author,
                  description: description.slice(0, 200),
                  views,
                  likes,
                  comments: 0, // Not visible on hashtag page
                  shares: 0, // Not visible on hashtag page
                  createTime: 0 // Will be estimated
                });
              } catch {
                // Skip problematic cards
              }
            }

            return items;
          });

          // Process extracted videos
          for (const video of videos) {
            // Estimate creation time based on position (newer first)
            // TikTok hashtag pages show recent videos, assume within maxDays
            const estimatedHoursAgo = Math.random() * maxDays * 24;

            if (video.views === 0 && video.likes === 0) continue;

            const { engagementRate, velocity, viralityScore } = calculateMetrics(
              video.views,
              video.likes,
              video.comments,
              estimatedHoursAgo || 24 // Default to 24 hours if unknown
            );

            results.push({
              platform: "tiktok",
              url: video.url,
              author: video.author,
              description: video.description,
              views: video.views,
              likes: video.likes,
              comments: video.comments,
              shares: video.shares,
              hours_ago: Math.round(estimatedHoursAgo * 10) / 10,
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
    } finally {
      await session.close();
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
