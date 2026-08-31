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

          // Wait for the page to be interactive and videos to load
          // TikTok uses heavy JS, so we need to wait for it to finish
          let attempts = 0;
          const maxAttempts = 10;
          let foundLinks = 0;

          while (attempts < maxAttempts && foundLinks === 0) {
            await new Promise((r) => setTimeout(r, 2000));

            // Try scrolling to trigger lazy loading
            await cdpEvaluate(client, () => {
              window.scrollBy(0, 500);
            });

            foundLinks = await cdpEvaluate<number>(client, () =>
              document.querySelectorAll('a[href*="/video/"]').length
            );

            attempts++;
            console.log(`TikTok attempt ${attempts}/${maxAttempts}: found ${foundLinks} video links`);
          }

          // Additional scrolls if we found some videos
          if (foundLinks > 0) {
            for (let i = 0; i < scrollCount; i++) {
              await cdpEvaluate(client, () => {
                window.scrollBy(0, 800);
              });
              await new Promise((r) => setTimeout(r, 1000));
            }
            await new Promise((r) => setTimeout(r, 2000));
          }

          // Debug: Get page info
          const pageDebug = await cdpEvaluate<{
            title: string;
            url: string;
            bodyText: string;
            allLinks: number;
            videoLinks: number;
          }>(client, () => ({
            title: document.title,
            url: window.location.href,
            bodyText: document.body?.textContent?.slice(0, 500) ?? "",
            allLinks: document.querySelectorAll("a").length,
            videoLinks: document.querySelectorAll('a[href*="/video/"]').length
          }));
          console.log(`TikTok debug: title="${pageDebug.title}" url="${pageDebug.url}" allLinks=${pageDebug.allLinks} videoLinks=${pageDebug.videoLinks}`);
          console.log(`TikTok bodyText: ${pageDebug.bodyText.slice(0, 200)}`);

          // Step 1: Collect video links from hashtag page
          const videoLinks = await cdpEvaluate<string[]>(client, () => {
            const links: string[] = [];
            document.querySelectorAll('a[href*="/video/"]').forEach((a) => {
              const href = (a as HTMLAnchorElement).href;
              if (href && !links.includes(href)) {
                links.push(href);
              }
            });
            return links;
          });

          console.log(`TikTok #${tag}: found ${videoLinks.length} video links`);

          // Step 2: Visit each video to get detailed stats
          const videosToProcess = videoLinks.slice(0, limit);
          for (const videoUrl of videosToProcess) {
            if (results.length >= limit) break;

            try {
              await cdpGoto(client, videoUrl, 15000);
              await new Promise((r) => setTimeout(r, 2000));

              // Extract video details from video page
              const details = await cdpEvaluate<{
                author: string;
                description: string;
                views: number;
                likes: number;
                comments: number;
                shares: number;
                timeText: string;
              }>(client, () => {
                const parseCount = (str: string | null | undefined): number => {
                  if (!str) return 0;
                  const s = str.toLowerCase().trim();
                  const num = parseFloat(s.replace(/[^\d.kmKM]/g, ""));
                  if (isNaN(num)) return 0;
                  if (s.includes("m") || s.includes("м")) return Math.round(num * 1000000);
                  if (s.includes("k") || s.includes("к") || s.includes("тыс")) return Math.round(num * 1000);
                  return parseInt(s.replace(/\D/g, "")) || 0;
                };

                // Author
                const authorEl = document.querySelector(
                  '[data-e2e="browse-username"], [data-e2e="video-author-uniqueid"]'
                );
                const author = authorEl?.textContent?.replace("@", "").trim() ?? "unknown";

                // Description
                const descEl = document.querySelector(
                  '[data-e2e="browse-video-desc"], [data-e2e="video-desc"]'
                );
                const description = descEl?.textContent ?? "";

                // Stats
                const likeEl = document.querySelector(
                  '[data-e2e="like-count"], [data-e2e="browse-like-count"]'
                );
                const commentEl = document.querySelector(
                  '[data-e2e="comment-count"], [data-e2e="browse-comment-count"]'
                );
                const shareEl = document.querySelector('[data-e2e="share-count"]');
                const viewEl = document.querySelector('[data-e2e="video-views"]');

                let views = parseCount(viewEl?.textContent);
                const likes = parseCount(likeEl?.textContent);
                const comments = parseCount(commentEl?.textContent);
                const shares = parseCount(shareEl?.textContent);

                // Estimate views from likes if not available
                if (views === 0 && likes > 0) {
                  views = likes * 30;
                }

                // Find time text
                let timeText = "";
                document.querySelectorAll('[class*="SpanOtherInfos"], span').forEach((el) => {
                  const t = el.textContent ?? "";
                  if (t.match(/\d+\s*(час|hour|дн|day|нед|week|мин|min|д\.)/i)) {
                    timeText = t;
                  }
                });

                return { author, description: description.slice(0, 200), views, likes, comments, shares, timeText };
              });

              // Skip if no engagement
              if (details.likes === 0 && details.comments === 0) continue;

              // Parse time
              let hoursAgo = 24;
              const timeText = (details.timeText || "").toLowerCase();
              if (timeText.includes("мин") || timeText.includes("min")) {
                const digits = timeText.replace(/\D/g, "");
                hoursAgo = digits ? Math.max(parseInt(digits) / 60, 0.5) : 0.5;
              } else if (timeText.includes("час") || timeText.includes("hour") || timeText.includes("ч")) {
                const digits = timeText.replace(/\D/g, "");
                hoursAgo = digits ? parseInt(digits) : 1;
              } else if (timeText.includes("дн") || timeText.includes("day") || timeText.includes("д")) {
                const digits = timeText.replace(/\D/g, "");
                hoursAgo = digits ? parseInt(digits) * 24 : 24;
              } else if (timeText.includes("нед") || timeText.includes("week")) {
                const digits = timeText.replace(/\D/g, "");
                hoursAgo = digits ? parseInt(digits) * 24 * 7 : 168;
              }

              // Skip if too old
              if (hoursAgo > maxDays * 24) continue;

              const { engagementRate, velocity, viralityScore } = calculateMetrics(
                details.views,
                details.likes,
                details.comments,
                hoursAgo
              );

              results.push({
                platform: "tiktok",
                url: videoUrl,
                author: details.author,
                description: details.description,
                views: details.views,
                likes: details.likes,
                comments: details.comments,
                shares: details.shares,
                hours_ago: Math.round(hoursAgo * 10) / 10,
                engagement_rate: engagementRate,
                velocity,
                virality_score: viralityScore,
                is_video: true
              });
            } catch (err) {
              console.error(`Error processing video ${videoUrl}:`, err);
            }
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
