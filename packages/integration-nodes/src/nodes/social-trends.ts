import { BaseNode, prop } from "@nodetool-ai/node-sdk";
import { tagAsServer } from "@nodetool-ai/nodes-utils";
import https from "https";

/** Make HTTPS POST request using Node's https module (bypasses undici's Sec-Fetch headers) */
async function httpsPost(
  url: string,
  headers: Record<string, string>,
  body: string
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      family: 4, // Force IPv4 for VPN routing
      headers: {
        ...headers,
        "Content-Length": Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, data }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

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

  // If input is a string, try to parse as JSON first
  let input = cookiesInput;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        input = JSON.parse(trimmed);
      } catch {
        // Not valid JSON, treat as cookie string below
      }
    }
  }

  // Handle array of cookie objects (from browser export)
  if (Array.isArray(input)) {
    for (const c of input as Cookie[]) {
      if (c.name && c.value) {
        cookies.set(c.name, c.value);
      }
    }
    return cookies;
  }

  // Handle object {name: value}
  if (typeof input === "object" && input !== null) {
    for (const [name, value] of Object.entries(
      input as Record<string, string>
    )) {
      cookies.set(name, String(value));
    }
    return cookies;
  }

  // Handle cookie string "name=value; name2=value2"
  if (typeof input === "string") {
    const parts = input.split(";");
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

/** Convert cookie input to Playwright cookie format */
function toPlaywrightCookies(
  cookiesInput: unknown,
  domain: string
): Array<{
  name: string;
  value: string;
  domain: string;
  path: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}> {
  const result: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
  }> = [];

  if (!cookiesInput) return result;

  // If input is a string, try to parse as JSON first
  let input = cookiesInput;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        input = JSON.parse(trimmed);
      } catch {
        // Not valid JSON, treat as cookie string below
      }
    }
  }

  // Handle array of cookie objects (from browser export like Cookie-Editor)
  if (Array.isArray(input)) {
    for (const c of input as Cookie[]) {
      if (c.name && c.value) {
        result.push({
          name: c.name,
          value: c.value,
          domain: c.domain ?? domain,
          path: c.path ?? "/",
          secure: c.secure ?? true,
          httpOnly: c.httpOnly ?? false,
          sameSite: "None" as const
        });
      }
    }
    return result;
  }

  // Handle object {name: value}
  if (typeof input === "object" && input !== null) {
    for (const [name, value] of Object.entries(
      input as Record<string, string>
    )) {
      result.push({
        name,
        value: String(value),
        domain,
        path: "/",
        secure: true,
        httpOnly: false,
        sameSite: "None" as const
      });
    }
    return result;
  }

  // Handle cookie string "name=value; name2=value2"
  if (typeof input === "string") {
    const parts = input.split(";");
    for (const part of parts) {
      const [name, ...valueParts] = part.trim().split("=");
      if (name && valueParts.length > 0) {
        result.push({
          name: name.trim(),
          value: valueParts.join("=").trim(),
          domain,
          path: "/",
          secure: true,
          httpOnly: false,
          sameSite: "None" as const
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
    type: "json",
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
        const response = await httpsPost(
          `https://i.instagram.com/api/v1/tags/${encodeURIComponent(tag)}/sections/`,
          {
            "User-Agent":
              "Instagram 358.0.0.46.92 Android (34/14; 420dpi; 1080x2400; samsung; SM-S918B; dm3q; qcom)",
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: cookieHeader(cookieMap),
            "X-CSRFToken": cookieMap.get("csrftoken") ?? "",
            "X-IG-App-ID": "936619743392459"
          },
          "tab=recent&page=0"
        );

        if (response.status !== 200) {
          console.error(
            `Instagram API error for #${tag}: ${response.status}`
          );
          continue;
        }

        const data = JSON.parse(response.data) as InstagramHashtagResponse;
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
    "Analyze trending TikTok videos by hashtag using Playwright browser automation. Returns engagement metrics and virality scores.\n    tiktok, trends, analytics, hashtags, engagement, playwright";
  static readonly metadataOutputTypes = {
    output: "list[dict[str, any]]"
  };
  static readonly inlineFields = [];
  static readonly inputFields = ["hashtags"];

  @prop({
    type: "json",
    default: null,
    title: "Cookies",
    description:
      "Optional TikTok cookies exported from browser (Cookie-Editor JSON format). Works without cookies too.",
    required: false
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
    const hashtags = (this.hashtags as string[]) ?? [];
    const maxDays = Number(this.days ?? 3);
    const limit = Number(this.limit ?? 50);
    const scrollCount = Number(this.scrollCount ?? 8);

    const results: AnalyzedPost[] = [];

    // Import Playwright
    const { chromium } = await import("playwright");

    // Check if we have a display (xvfb or real)
    const hasDisplay = !!process.env.DISPLAY;

    // Use headed mode when display available (much lower block rate: 14-22% vs 58%)
    // Fall back to headless if no display
    const useHeaded = hasDisplay;
    console.log(`TikTok: using ${useHeaded ? "headed" : "headless"} mode (DISPLAY=${process.env.DISPLAY || "none"})`);

    // Launch browser with anti-detection settings
    const browser = await chromium.launch({
      headless: !useHeaded,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-web-security",
        "--disable-features=IsolateOrigins,site-per-process",
        "--disable-infobars",
        "--window-size=1920,1080",
        "--start-maximized"
      ]
    });

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "en-US",
      timezoneId: "America/New_York",
      // Extra anti-detection
      javaScriptEnabled: true,
      hasTouch: false,
      isMobile: false,
      deviceScaleFactor: 1,
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"'
      }
    });

    // Set cookies if provided (optional - works without them too)
    const playwrightCookies = toPlaywrightCookies(this.cookies, ".tiktok.com");
    if (playwrightCookies.length > 0) {
      await context.addCookies(playwrightCookies);
    }

    const page = await context.newPage();

    // Hide webdriver flag and add realistic browser properties
    await page.addInitScript(() => {
      // Remove webdriver property entirely
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });

      // Add chrome object
      // @ts-ignore
      window.chrome = {
        runtime: {},
        loadTimes: () => ({}),
        csi: () => ({}),
        app: { isInstalled: false }
      };

      // Override plugins to look real
      Object.defineProperty(navigator, "plugins", {
        get: () => [
          { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer" },
          { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai" },
          { name: "Native Client", filename: "internal-nacl-plugin" }
        ]
      });

      // Override languages
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"]
      });

      // Realistic hardware concurrency
      Object.defineProperty(navigator, "hardwareConcurrency", {
        get: () => 8
      });

      // Realistic device memory
      Object.defineProperty(navigator, "deviceMemory", {
        get: () => 8
      });

      // Override WebGL renderer for realistic GPU
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return "Intel Inc.";
        if (parameter === 37446) return "Intel Iris OpenGL Engine";
        return getParameter.call(this, parameter);
      };
    });

    try {
      for (const hashtag of hashtags) {
        const tag = hashtag.replace(/^#/, "").toLowerCase();
        const tagUrl = `https://www.tiktok.com/tag/${encodeURIComponent(tag)}`;

        console.log(`TikTok: analyzing #${tag}...`);

        try {
          await page.goto(tagUrl, { waitUntil: "load", timeout: 60000 });

          // Wait for video grid to load (TikTok lazy-loads content)
          console.log(`TikTok: waiting for video content to load...`);
          try {
            await page.waitForSelector('a[href*="/video/"]', { timeout: 15000 });
            console.log(`TikTok: video links appeared`);
          } catch {
            console.log(`TikTok: no video links found after 15s, continuing anyway`);
          }
          await page.waitForTimeout(3000);

          // Save screenshot for debugging
          try {
            await page.screenshot({ path: `/tmp/tiktok-${tag}.png`, fullPage: false });
            console.log(`TikTok: saved screenshot to /tmp/tiktok-${tag}.png`);
          } catch (e) {
            console.log(`TikTok: failed to save screenshot: ${e}`);
          }

          // Debug: Take a screenshot and log the page state
          const pageInfo = await page.evaluate(() => ({
            title: document.title,
            url: window.location.href,
            bodyText: document.body?.textContent?.slice(0, 500) ?? "",
            allLinks: document.querySelectorAll("a").length,
            videoLinks: document.querySelectorAll('a[href*="/video/"]').length
          }));
          console.log(
            `TikTok page: title="${pageInfo.title}" links=${pageInfo.allLinks} videos=${pageInfo.videoLinks}`
          );
          console.log(`TikTok bodyText preview: ${pageInfo.bodyText.slice(0, 200)}`);

          // Scroll to load more videos (larger scrolls, longer waits for lazy loading)
          for (let i = 0; i < scrollCount; i++) {
            await page.evaluate(() => window.scrollBy(0, 800));
            await page.waitForTimeout(2000);
          }
          await page.waitForTimeout(3000);

          // Check again after scrolling
          const afterScroll = await page.evaluate(
            () => document.querySelectorAll('a[href*="/video/"]').length
          );
          console.log(`TikTok after ${scrollCount} scrolls: ${afterScroll} video links`);

          // Collect video links
          const videoLinks = await page.evaluate(() => {
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

          // Process each video
          const videosToProcess = videoLinks.slice(0, limit);
          let processed = 0;

          for (const videoUrl of videosToProcess) {
            if (results.length >= limit) break;

            try {
              await page.goto(videoUrl);
              await page.waitForTimeout(2500);

              const details = await page.evaluate(() => {
                const parseCount = (str: string | null | undefined): number => {
                  if (!str) return 0;
                  const s = str.toLowerCase().trim();
                  const num = parseFloat(s.replace(/[^\d.kmKM]/g, ""));
                  if (isNaN(num)) return 0;
                  if (s.includes("m") || s.includes("м"))
                    return Math.round(num * 1000000);
                  if (s.includes("k") || s.includes("к") || s.includes("тыс"))
                    return Math.round(num * 1000);
                  return parseInt(s.replace(/\D/g, "")) || 0;
                };

                // Author
                const authorEl = document.querySelector(
                  '[data-e2e="browse-username"], [data-e2e="video-author-uniqueid"]'
                );
                const author =
                  authorEl?.textContent?.replace("@", "").trim() ?? "unknown";

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
                document
                  .querySelectorAll('[class*="SpanOtherInfos"], span')
                  .forEach((el) => {
                    const t = el.textContent ?? "";
                    if (t.match(/\d+\s*(час|hour|дн|day|нед|week|мин|min|д\.)/i)) {
                      timeText = t;
                    }
                  });

                // Also try finding date in YYYY-MM-DD format
                const dateMatch = document.body.textContent?.match(
                  /(\d{4}-\d{1,2}-\d{1,2})/
                );

                return {
                  author,
                  description: description.slice(0, 300),
                  views,
                  likes,
                  comments,
                  shares,
                  timeText,
                  dateMatch: dateMatch ? dateMatch[1] : null
                };
              });

              // Skip if no engagement
              if (details.likes === 0 && details.comments === 0) continue;

              // Parse time
              let hoursAgo = 24;
              const timeText = (details.timeText || "").toLowerCase();

              if (details.dateMatch) {
                try {
                  const postDate = new Date(details.dateMatch);
                  hoursAgo =
                    (Date.now() - postDate.getTime()) / (1000 * 60 * 60);
                } catch {
                  // ignore
                }
              } else if (timeText.includes("мин") || timeText.includes("min")) {
                const digits = timeText.replace(/\D/g, "");
                hoursAgo = digits
                  ? Math.max(parseInt(digits) / 60, 0.5)
                  : 0.5;
              } else if (
                timeText.includes("час") ||
                timeText.includes("hour") ||
                timeText.includes("ч")
              ) {
                const digits = timeText.replace(/\D/g, "");
                hoursAgo = digits ? parseInt(digits) : 1;
              } else if (
                timeText.includes("дн") ||
                timeText.includes("day") ||
                timeText.includes("д")
              ) {
                const digits = timeText.replace(/\D/g, "");
                hoursAgo = digits ? parseInt(digits) * 24 : 24;
              } else if (timeText.includes("нед") || timeText.includes("week")) {
                const digits = timeText.replace(/\D/g, "");
                hoursAgo = digits ? parseInt(digits) * 24 * 7 : 168;
              }

              // Skip if too old
              if (hoursAgo > maxDays * 24) continue;

              const { engagementRate, velocity, viralityScore } =
                calculateMetrics(
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

              processed++;
            } catch (err) {
              console.error(`Error processing video ${videoUrl}:`, err);
            }
          }

          console.log(`TikTok #${tag}: processed ${processed} videos`);
        } catch (err) {
          console.error(`Error fetching #${tag}:`, err);
        }

        await page.waitForTimeout(2000);
      }
    } finally {
      await browser.close();
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
