import { BaseNode, prop } from "@nodetool-ai/node-sdk";
import { tagAsServer } from "@nodetool-ai/nodes-utils";
import { Agent, fetch as undiciFetch } from "undici";

const DEFAULT_PAGE_FUNCTION =
  "async function pageFunction(context) { return context.request.loadedUrl; }";
const MIN_RESULTS_PER_PAGE = 10;
const MAX_RESULTS_PER_PAGE = 100;

const APIFY_API_BASE = "https://api.apify.com/v2";

// Page size for paginated fetching - small to avoid network timeouts
const DATASET_PAGE_SIZE = 5;

// Local agent for Apify requests only - forces IPv4 without affecting global dispatcher
const apifyAgent = new Agent({
  connect: {
    family: 4 // Force IPv4
  }
});

function getApifyApiKey(secrets: Record<string, string>): string {
  const key = secrets.APIFY_API_TOKEN || process.env.APIFY_API_TOKEN;
  if (!key) throw new Error("APIFY_API_TOKEN not configured");
  return key;
}

interface ApifyRun {
  data?: {
    id?: string;
    defaultDatasetId?: string;
    status?: string;
  };
}

/**
 * Fetch a single page of JSON with retry logic
 */
async function fetchPageWithRetry<T>(
  url: string,
  headers: Record<string, string>,
  maxRetries = 3,
  timeoutMs = 30000
): Promise<{ data: T; total: number }> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await undiciFetch(url, {
        headers: {
          ...headers,
          "Accept-Encoding": "gzip, deflate" // Request compression
        },
        signal: controller.signal,
        dispatcher: apifyAgent // Use local IPv4-only agent
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
      }

      // Get total count from Apify pagination header
      const total = parseInt(response.headers.get("x-apify-pagination-total") ?? "0", 10);
      const data = (await response.json()) as T;
      return { data, total };
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err instanceof Error ? err : new Error(String(err));
      const errMsg = lastError.message.toLowerCase();
      const isRetryable =
        errMsg.includes("timeout") ||
        errMsg.includes("etimedout") ||
        errMsg.includes("econnreset") ||
        errMsg.includes("terminated") ||
        errMsg.includes("abort") ||
        lastError.name === "AbortError";

      if (!isRetryable || attempt >= maxRetries - 1) {
        throw lastError;
      }

      const delay = 1000 * Math.pow(2, attempt);
      console.log(`Apify: page fetch attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError ?? new Error("fetchPageWithRetry: unknown error");
}

/**
 * Fetch all dataset items using pagination to handle slow networks
 */
async function fetchDatasetPaginated(
  datasetId: string,
  apiKey: string,
  maxItems: number
): Promise<Record<string, unknown>[]> {
  const allItems: Record<string, unknown>[] = [];
  let offset = 0;
  let total = Infinity;
  const headers = { Authorization: `Bearer ${apiKey}` };

  console.log(`Apify: fetching dataset ${datasetId} with pagination...`);

  while (offset < total && allItems.length < maxItems) {
    const limit = Math.min(DATASET_PAGE_SIZE, maxItems - allItems.length);
    const url = `${APIFY_API_BASE}/datasets/${datasetId}/items?format=json&limit=${limit}&offset=${offset}`;

    const { data, total: pageTotal } = await fetchPageWithRetry<Record<string, unknown>[]>(
      url,
      headers
    );

    total = pageTotal;
    allItems.push(...data);
    offset += data.length;

    console.log(`Apify: fetched ${allItems.length}/${Math.min(total, maxItems)} items`);

    if (data.length === 0) break; // No more items
  }

  return allItems;
}

async function runActor(
  apiKey: string,
  actorId: string,
  input: Record<string, unknown>,
  waitSecs: number
): Promise<Record<string, unknown>[]> {
  const encodedActorId = actorId.replace("/", "~");
  const url = `${APIFY_API_BASE}/acts/${encodedActorId}/runs?waitForFinish=${waitSecs}`;

  console.log(`Apify: starting actor ${actorId}...`);
  const response = await undiciFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(input),
    dispatcher: apifyAgent
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Apify API error (${response.status}): ${text}`);
  }

  const run = (await response.json()) as ApifyRun;
  const runId = run.data?.id;
  const datasetId = run.data?.defaultDatasetId;
  let status = run.data?.status;

  console.log(`Apify: run ${runId} started, status=${status}, datasetId=${datasetId}`);

  if (!datasetId) {
    throw new Error(`Apify: no dataset ID returned for run ${runId}`);
  }

  // Poll for completion if not already done
  const terminalStatuses = ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"];
  const pollInterval = 5000; // 5 seconds
  const maxPolls = Math.ceil((waitSecs * 1000) / pollInterval);
  let polls = 0;

  while (!terminalStatuses.includes(status ?? "") && polls < maxPolls) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));
    polls++;

    const statusUrl = `${APIFY_API_BASE}/actor-runs/${runId}`;
    const statusResponse = await undiciFetch(statusUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      dispatcher: apifyAgent
    });

    if (statusResponse.ok) {
      const statusData = (await statusResponse.json()) as ApifyRun;
      status = statusData.data?.status;
      console.log(`Apify: poll ${polls}/${maxPolls}, status=${status}`);
    }
  }

  if (status !== "SUCCEEDED") {
    throw new Error(`Apify run ${runId} ended with status: ${status}`);
  }

  // Fetch results using pagination to handle slow networks reliably
  // Small page size (5 items) ensures each request completes quickly
  const maxItems = (input.resultsLimit ?? input.resultsPerPage ?? 30) as number;
  return fetchDatasetPaginated(datasetId, apiKey, Math.min(maxItems, 100));
}

export class ApifyWebScraperNode extends BaseNode {
  static readonly nodeType = "apify.scraping.ApifyWebScraper";
  static readonly title = "Apify Web Scraper";
  static readonly description =
    "Scrape websites using Apify's Web Scraper actor, extracting data via CSS selectors or custom JavaScript.\n    apify, scraping, web, data, extraction, crawler";
  static readonly metadataOutputTypes = {
    output: "list[dict[str, any]]"
  };
  static readonly requiredSettings = ["APIFY_API_TOKEN"];
  static readonly inlineFields = ["link_selector"];
  static readonly inputFields = ["start_urls"];

  @prop({
    type: "list[str]",
    default: null,
    title: "Start Urls",
    description: "List of URLs to scrape",
    required: true
  })
  declare start_urls: any;

  @prop({
    type: "str",
    default: "a[href]",
    title: "Link Selector",
    description: "CSS selector for links to follow"
  })
  declare link_selector: any;

  @prop({
    type: "str",
    default: "",
    title: "Page Function",
    description: "JavaScript function to execute on each page"
  })
  declare page_function: any;

  @prop({
    type: "int",
    default: 10,
    title: "Max Pages",
    description: "Maximum number of pages to scrape"
  })
  declare max_pages: any;

  @prop({
    type: "int",
    default: 300,
    title: "Wait For Finish",
    description: "Maximum time to wait for scraping to complete (seconds)"
  })
  declare wait_for_finish: any;

  async process(): Promise<Record<string, unknown>> {
    const apiKey = getApifyApiKey(this._secrets);
    const startUrls = (this.start_urls as string[]) ?? [];
    if (startUrls.length === 0) throw new Error("start_urls is required");

    const pageFunction =
      String(this.page_function ?? "") || DEFAULT_PAGE_FUNCTION;

    const runInput = {
      startUrls: startUrls.map((url: string) => ({ url })),
      linkSelector: String(this.link_selector ?? "a[href]"),
      pageFunction,
      maxPagesPerCrawl: Number(this.max_pages ?? 10)
    };

    const items = await runActor(
      apiKey,
      "apify/web-scraper",
      runInput,
      Number(this.wait_for_finish ?? 300)
    );
    return { output: items };
  }
}

export class ApifyGoogleSearchScraperNode extends BaseNode {
  static readonly nodeType = "apify.scraping.ApifyGoogleSearchScraper";
  static readonly title = "Apify Google Search Scraper";
  static readonly description =
    "Scrape Google Search results using Apify — organic results, ads, related searches, and more.\n    apify, google, search, serp, scraping, seo";
  static readonly metadataOutputTypes = {
    output: "list[dict[str, any]]"
  };
  static readonly requiredSettings = ["APIFY_API_TOKEN"];
  static readonly inlineFields = [];
  static readonly inputFields = ["queries"];

  @prop({
    type: "list[str]",
    default: null,
    title: "Queries",
    description: "List of search queries to execute",
    required: true
  })
  declare queries: any;

  @prop({
    type: "str",
    default: "us",
    title: "Country Code",
    description: "Country code for Google search (e.g., 'us', 'uk', 'de')"
  })
  declare country_code: any;

  @prop({
    type: "str",
    default: "en",
    title: "Language Code",
    description: "Language code for results (e.g., 'en', 'es', 'fr')"
  })
  declare language_code: any;

  @prop({
    type: "int",
    default: 1,
    title: "Max Pages",
    description: "Maximum number of result pages per query"
  })
  declare max_pages: any;

  @prop({
    type: "int",
    default: 100,
    title: "Results Per Page",
    description: "Number of results per page (10-100)"
  })
  declare results_per_page: any;

  @prop({
    type: "int",
    default: 300,
    title: "Wait For Finish",
    description: "Maximum time to wait for scraping to complete (seconds)"
  })
  declare wait_for_finish: any;

  async process(): Promise<Record<string, unknown>> {
    const apiKey = getApifyApiKey(this._secrets);
    const queries = (this.queries as string[]) ?? [];
    if (queries.length === 0) throw new Error("queries is required");

    const resultsPerPage = Math.min(
      Math.max(MIN_RESULTS_PER_PAGE, Number(this.results_per_page ?? 100)),
      MAX_RESULTS_PER_PAGE
    );

    const runInput = {
      queries: queries.join("\n"),
      countryCode: String(this.country_code ?? "us"),
      languageCode: String(this.language_code ?? "en"),
      maxPagesPerQuery: Number(this.max_pages ?? 1),
      resultsPerPage
    };

    const items = await runActor(
      apiKey,
      "apify/google-search-scraper",
      runInput,
      Number(this.wait_for_finish ?? 300)
    );
    return { output: items };
  }
}

export class ApifyInstagramScraperNode extends BaseNode {
  static readonly nodeType = "apify.scraping.ApifyInstagramScraper";
  static readonly title = "Apify Instagram Scraper";
  static readonly description =
    "Scrape Instagram profiles, posts, comments, and hashtags — user data, post details, and engagement metrics.\n    apify, instagram, social, media, scraping, posts, profiles";
  static readonly metadataOutputTypes = {
    output: "list[dict[str, any]]"
  };
  static readonly requiredSettings = ["APIFY_API_TOKEN"];
  static readonly inlineFields = [];
  static readonly inputFields = ["usernames", "hashtags"];

  @prop({
    type: "list[str]",
    default: [],
    title: "Usernames",
    description: "List of Instagram usernames to scrape (at least one of usernames or hashtags required)"
  })
  declare usernames: any;

  @prop({
    type: "list[str]",
    default: [],
    title: "Hashtags",
    description: "List of hashtags to scrape (at least one of usernames or hashtags required)"
  })
  declare hashtags: any;

  @prop({
    type: "int",
    default: 50,
    title: "Results Limit",
    description: "Maximum number of posts to scrape per profile/hashtag"
  })
  declare results_limit: any;

  @prop({
    type: "bool",
    default: false,
    title: "Scrape Comments",
    description: "Whether to scrape comments on posts"
  })
  declare scrape_comments: any;

  @prop({
    type: "bool",
    default: false,
    title: "Scrape Likes",
    description: "Whether to scrape likes on posts"
  })
  declare scrape_likes: any;

  @prop({
    type: "int",
    default: 600,
    title: "Wait For Finish",
    description: "Maximum time to wait for scraping to complete (seconds)"
  })
  declare wait_for_finish: any;

  async process(): Promise<Record<string, unknown>> {
    const apiKey = getApifyApiKey(this._secrets);
    const usernames = (this.usernames as string[]) ?? [];
    const hashtags = (this.hashtags as string[]) ?? [];
    if (usernames.length === 0 && hashtags.length === 0) {
      throw new Error("Either usernames or hashtags is required");
    }

    const runInput: Record<string, unknown> = {
      resultsLimit: Number(this.results_limit ?? 50),
      scrapeComments: Boolean(this.scrape_comments ?? false),
      scrapeLikes: Boolean(this.scrape_likes ?? false)
    };

    // Convert usernames and hashtags to directUrls format (Apify's current API requirement)
    const directUrls: string[] = [];
    for (const username of usernames) {
      // Handle both raw username and full URL
      if (username.startsWith("http")) {
        directUrls.push(username);
      } else {
        directUrls.push(`https://www.instagram.com/${username.replace(/^@/, "")}/`);
      }
    }
    for (const hashtag of hashtags) {
      // Handle both raw hashtag and full URL
      if (hashtag.startsWith("http")) {
        directUrls.push(hashtag);
      } else {
        directUrls.push(
          `https://www.instagram.com/explore/tags/${hashtag.replace(/^#/, "")}/`
        );
      }
    }

    if (directUrls.length > 0) runInput.directUrls = directUrls;

    const items = await runActor(
      apiKey,
      "apify/instagram-scraper",
      runInput,
      Number(this.wait_for_finish ?? 600)
    );
    return { output: items };
  }
}

export class ApifyAmazonScraperNode extends BaseNode {
  static readonly nodeType = "apify.scraping.ApifyAmazonScraper";
  static readonly title = "Apify Amazon Scraper";
  static readonly description =
    "Scrape Amazon product data including prices, ratings, seller information, and customer reviews.\n    apify, amazon, ecommerce, products, scraping, prices, reviews";
  static readonly metadataOutputTypes = {
    output: "list[dict[str, any]]"
  };
  static readonly requiredSettings = ["APIFY_API_TOKEN"];
  static readonly inlineFields = [];
  static readonly inputFields = ["search_queries", "product_urls"];

  @prop({
    type: "list[str]",
    default: null,
    title: "Search Queries",
    description: "List of search queries to execute on Amazon",
    required: true
  })
  declare search_queries: any;

  @prop({
    type: "list[str]",
    default: null,
    title: "Product Urls",
    description: "List of Amazon product URLs to scrape",
    required: true
  })
  declare product_urls: any;

  @prop({
    type: "str",
    default: "US",
    title: "Country Code",
    description: "Amazon country code (US, UK, DE, FR, ES, IT, etc.)"
  })
  declare country_code: any;

  @prop({
    type: "int",
    default: 20,
    title: "Max Items",
    description: "Maximum number of products to scrape per search"
  })
  declare max_items: any;

  @prop({
    type: "bool",
    default: false,
    title: "Scrape Reviews",
    description: "Whether to scrape product reviews"
  })
  declare scrape_reviews: any;

  @prop({
    type: "int",
    default: 600,
    title: "Wait For Finish",
    description: "Maximum time to wait for scraping to complete (seconds)"
  })
  declare wait_for_finish: any;

  async process(): Promise<Record<string, unknown>> {
    const apiKey = getApifyApiKey(this._secrets);
    const searchQueries = (this.search_queries as string[]) ?? [];
    const productUrls = (this.product_urls as string[]) ?? [];
    if (searchQueries.length === 0 && productUrls.length === 0) {
      throw new Error("Either search_queries or product_urls is required");
    }

    const runInput: Record<string, unknown> = {
      countryCode: String(this.country_code ?? "US"),
      maxItems: Number(this.max_items ?? 20),
      scrapeReviews: Boolean(this.scrape_reviews ?? false)
    };

    if (searchQueries.length > 0) runInput.searchQueries = searchQueries;
    if (productUrls.length > 0) runInput.productUrls = productUrls;

    const items = await runActor(
      apiKey,
      "apify/amazon-product-scraper",
      runInput,
      Number(this.wait_for_finish ?? 600)
    );
    return { output: items };
  }
}

export class ApifyYouTubeScraperNode extends BaseNode {
  static readonly nodeType = "apify.scraping.ApifyYouTubeScraper";
  static readonly title = "Apify You Tube Scraper";
  static readonly description =
    "Scrape YouTube videos, channels, and playlists — metadata, comments, channel info, and statistics.\n    apify, youtube, video, scraping, social, media, channels";
  static readonly metadataOutputTypes = {
    output: "list[dict[str, any]]"
  };
  static readonly requiredSettings = ["APIFY_API_TOKEN"];
  static readonly inlineFields = [];
  static readonly inputFields = ["search_queries", "video_urls", "channel_urls"];

  @prop({
    type: "list[str]",
    default: null,
    title: "Search Queries",
    description: "List of search queries to execute on YouTube",
    required: true
  })
  declare search_queries: any;

  @prop({
    type: "list[str]",
    default: null,
    title: "Video Urls",
    description: "List of YouTube video URLs to scrape",
    required: true
  })
  declare video_urls: any;

  @prop({
    type: "list[str]",
    default: null,
    title: "Channel Urls",
    description: "List of YouTube channel URLs to scrape",
    required: true
  })
  declare channel_urls: any;

  @prop({
    type: "int",
    default: 50,
    title: "Max Results",
    description: "Maximum number of videos to scrape"
  })
  declare max_results: any;

  @prop({
    type: "bool",
    default: false,
    title: "Scrape Comments",
    description: "Whether to scrape video comments"
  })
  declare scrape_comments: any;

  @prop({
    type: "int",
    default: 600,
    title: "Wait For Finish",
    description: "Maximum time to wait for scraping to complete (seconds)"
  })
  declare wait_for_finish: any;

  async process(): Promise<Record<string, unknown>> {
    const apiKey = getApifyApiKey(this._secrets);
    const searchQueries = (this.search_queries as string[]) ?? [];
    const videoUrls = (this.video_urls as string[]) ?? [];
    const channelUrls = (this.channel_urls as string[]) ?? [];
    if (
      searchQueries.length === 0 &&
      videoUrls.length === 0 &&
      channelUrls.length === 0
    ) {
      throw new Error(
        "At least one of search_queries, video_urls, or channel_urls is required"
      );
    }

    const startUrls: { url: string }[] = [];
    for (const query of searchQueries) {
      startUrls.push({
        url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
      });
    }
    for (const url of videoUrls) {
      startUrls.push({ url });
    }
    for (const url of channelUrls) {
      startUrls.push({ url });
    }

    const runInput = {
      startUrls,
      maxResults: Number(this.max_results ?? 50),
      scrapeComments: Boolean(this.scrape_comments ?? false)
    };

    const items = await runActor(
      apiKey,
      "apify/youtube-scraper",
      runInput,
      Number(this.wait_for_finish ?? 600)
    );
    return { output: items };
  }
}

export class ApifyTwitterScraperNode extends BaseNode {
  static readonly nodeType = "apify.scraping.ApifyTwitterScraper";
  static readonly title = "Apify Twitter Scraper";
  static readonly description =
    "Scrape Twitter/X posts, profiles, and followers — tweets, user information, and engagement metrics.\n    apify, twitter, x, social, media, scraping, tweets, posts";
  static readonly metadataOutputTypes = {
    output: "list[dict[str, any]]"
  };
  static readonly requiredSettings = ["APIFY_API_TOKEN"];
  static readonly inlineFields = [];
  static readonly inputFields = ["search_terms", "usernames", "tweet_urls"];

  @prop({
    type: "list[str]",
    default: null,
    title: "Search Terms",
    description: "List of search terms to find tweets",
    required: true
  })
  declare search_terms: any;

  @prop({
    type: "list[str]",
    default: null,
    title: "Usernames",
    description: "List of Twitter usernames to scrape",
    required: true
  })
  declare usernames: any;

  @prop({
    type: "list[str]",
    default: null,
    title: "Tweet Urls",
    description: "List of specific tweet URLs to scrape",
    required: true
  })
  declare tweet_urls: any;

  @prop({
    type: "int",
    default: 100,
    title: "Max Tweets",
    description: "Maximum number of tweets to scrape"
  })
  declare max_tweets: any;

  @prop({
    type: "int",
    default: 600,
    title: "Wait For Finish",
    description: "Maximum time to wait for scraping to complete (seconds)"
  })
  declare wait_for_finish: any;

  async process(): Promise<Record<string, unknown>> {
    const apiKey = getApifyApiKey(this._secrets);
    const searchTerms = (this.search_terms as string[]) ?? [];
    const usernames = (this.usernames as string[]) ?? [];
    const tweetUrls = (this.tweet_urls as string[]) ?? [];
    if (
      searchTerms.length === 0 &&
      usernames.length === 0 &&
      tweetUrls.length === 0
    ) {
      throw new Error(
        "At least one of search_terms, usernames, or tweet_urls is required"
      );
    }

    const startUrls: string[] = [];
    for (const term of searchTerms) {
      startUrls.push(
        `https://twitter.com/search?q=${encodeURIComponent(term)}`
      );
    }
    for (const username of usernames) {
      startUrls.push(`https://twitter.com/${username}`);
    }
    startUrls.push(...tweetUrls);

    const runInput = {
      startUrls,
      maxItems: Number(this.max_tweets ?? 100)
    };

    const items = await runActor(
      apiKey,
      "apify/twitter-scraper",
      runInput,
      Number(this.wait_for_finish ?? 600)
    );
    return { output: items };
  }
}

export class ApifyLinkedInScraperNode extends BaseNode {
  static readonly nodeType = "apify.scraping.ApifyLinkedInScraper";
  static readonly title = "Apify Linked In Scraper";
  static readonly description =
    "Scrape LinkedIn profiles, company pages, and job postings — professional info, connections, and company data.\n    apify, linkedin, professional, social, scraping, profiles, jobs";
  static readonly metadataOutputTypes = {
    output: "list[dict[str, any]]"
  };
  static readonly requiredSettings = ["APIFY_API_TOKEN"];
  static readonly inlineFields = [];
  static readonly inputFields = ["profile_urls", "company_urls", "job_search_urls"];

  @prop({
    type: "list[str]",
    default: null,
    title: "Profile Urls",
    description: "List of LinkedIn profile URLs to scrape",
    required: true
  })
  declare profile_urls: any;

  @prop({
    type: "list[str]",
    default: null,
    title: "Company Urls",
    description: "List of LinkedIn company page URLs to scrape",
    required: true
  })
  declare company_urls: any;

  @prop({
    type: "list[str]",
    default: null,
    title: "Job Search Urls",
    description: "List of LinkedIn job search URLs",
    required: true
  })
  declare job_search_urls: any;

  @prop({
    type: "int",
    default: 50,
    title: "Max Results",
    description: "Maximum number of results to scrape"
  })
  declare max_results: any;

  @prop({
    type: "int",
    default: 600,
    title: "Wait For Finish",
    description: "Maximum time to wait for scraping to complete (seconds)"
  })
  declare wait_for_finish: any;

  async process(): Promise<Record<string, unknown>> {
    const apiKey = getApifyApiKey(this._secrets);
    const profileUrls = (this.profile_urls as string[]) ?? [];
    const companyUrls = (this.company_urls as string[]) ?? [];
    const jobSearchUrls = (this.job_search_urls as string[]) ?? [];
    if (
      profileUrls.length === 0 &&
      companyUrls.length === 0 &&
      jobSearchUrls.length === 0
    ) {
      throw new Error(
        "At least one of profile_urls, company_urls, or job_search_urls is required"
      );
    }

    const allUrls = [...profileUrls, ...companyUrls, ...jobSearchUrls];

    const runInput = {
      startUrls: allUrls.map((url: string) => ({ url })),
      maxResults: Number(this.max_results ?? 50)
    };

    const items = await runActor(
      apiKey,
      "apify/linkedin-profile-scraper",
      runInput,
      Number(this.wait_for_finish ?? 600)
    );
    return { output: items };
  }
}

export class ApifyTikTokScraperNode extends BaseNode {
  static readonly nodeType = "apify.scraping.ApifyTikTokScraper";
  static readonly title = "Apify TikTok Scraper";
  static readonly description =
    "Scrape TikTok videos, profiles, hashtags, and trends — views, likes, comments, and video metadata. No login required, bypasses anti-bot protection.\n    apify, tiktok, social, video, scraping, trends, hashtags";
  static readonly metadataOutputTypes = {
    output: "list[dict[str, any]]"
  };
  static readonly requiredSettings = ["APIFY_API_TOKEN"];
  static readonly inlineFields = ["hashtags"];
  static readonly inputFields = ["hashtags", "profiles", "video_urls"];

  @prop({
    type: "list[str]",
    default: null,
    title: "Hashtags",
    description: "List of hashtags to scrape (without #)",
    required: false
  })
  declare hashtags: any;

  @prop({
    type: "list[str]",
    default: null,
    title: "Profiles",
    description: "List of TikTok usernames to scrape",
    required: false
  })
  declare profiles: any;

  @prop({
    type: "list[str]",
    default: null,
    title: "Video Urls",
    description: "List of specific TikTok video URLs to scrape",
    required: false
  })
  declare video_urls: any;

  @prop({
    type: "int",
    default: 30,
    title: "Results Per Page",
    description: "Number of videos to scrape per hashtag/profile",
    min: 1,
    max: 100
  })
  declare results_per_page: any;

  @prop({
    type: "int",
    default: 600,
    title: "Wait For Finish",
    description: "Maximum time to wait for scraping to complete (seconds)"
  })
  declare wait_for_finish: any;

  async process(): Promise<Record<string, unknown>> {
    const apiKey = getApifyApiKey(this._secrets);
    const hashtags = (this.hashtags as string[]) ?? [];
    const profiles = (this.profiles as string[]) ?? [];
    const videoUrls = (this.video_urls as string[]) ?? [];

    if (hashtags.length === 0 && profiles.length === 0 && videoUrls.length === 0) {
      throw new Error("At least one of hashtags, profiles, or video_urls is required");
    }

    // Build input for the TikTok scraper actor
    const runInput: Record<string, unknown> = {
      resultsPerPage: Number(this.results_per_page ?? 30),
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadSubtitles: false,
      shouldDownloadSlideshowImages: false
    };

    // Add hashtags
    if (hashtags.length > 0) {
      runInput.hashtags = hashtags.map((tag: string) => tag.replace(/^#/, ""));
    }

    // Add profiles
    if (profiles.length > 0) {
      runInput.profiles = profiles.map((profile: string) => profile.replace(/^@/, ""));
    }

    // Add specific video URLs
    if (videoUrls.length > 0) {
      runInput.postURLs = videoUrls;
    }

    const items = await runActor(
      apiKey,
      "clockworks/free-tiktok-scraper",
      runInput,
      Number(this.wait_for_finish ?? 600)
    );
    return { output: items };
  }
}

export class ApifyInstagramTrendsScraperNode extends BaseNode {
  static readonly nodeType = "apify.scraping.ApifyInstagramTrendsScraper";
  static readonly title = "Instagram Trends Scraper";
  static readonly description =
    "Scrape trending posts from Instagram Explore page — viral reels, posts with engagement metrics, audio trends, and creator info.\n    apify, instagram, trends, viral, reels, explore";
  static readonly metadataOutputTypes = {
    output: "list[dict[str, any]]"
  };
  static readonly requiredSettings = ["APIFY_API_TOKEN"];

  @prop({
    type: "str",
    default: "United States",
    title: "Country",
    description: "Country for Instagram locale (United States, Russia, United Kingdom, Germany, France, etc.)"
  })
  declare country: any;

  @prop({
    type: "int",
    default: 20,
    title: "Max Results",
    description: "Maximum number of trending posts to scrape"
  })
  declare max_results: any;

  @prop({
    type: "int",
    default: 300,
    title: "Wait For Finish",
    description: "Maximum time to wait for scraping to complete (seconds)"
  })
  declare wait_for_finish: any;

  async process(): Promise<Record<string, unknown>> {
    const apiKey = getApifyApiKey(this._secrets);

    const runInput: Record<string, unknown> = {
      country: String(this.country ?? "United States"),
      max_results: Number(this.max_results ?? 20)
    };

    const items = await runActor(
      apiKey,
      "agentx/instagram-trending-scraper",
      runInput,
      Number(this.wait_for_finish ?? 300)
    );
    return { output: items };
  }
}

export class ApifyTikTokTrendsScraperNode extends BaseNode {
  static readonly nodeType = "apify.scraping.ApifyTikTokTrendsScraper";
  static readonly title = "TikTok Trends Scraper";
  static readonly description =
    "Scrape real-time trending data from TikTok Creative Center — trending hashtags, sounds, creators, and videos with trend direction (rising/falling/stable).\n    apify, tiktok, trends, viral, hashtags, sounds, creators";
  static readonly metadataOutputTypes = {
    output: "list[dict[str, any]]"
  };
  static readonly requiredSettings = ["APIFY_API_TOKEN"];
  static readonly inlineFields = ["data_types"];

  @prop({
    type: "list[str]",
    default: ["hashtags", "videos"],
    title: "Data Types",
    description: "Types of trending data to scrape: hashtags, sounds, creators, videos"
  })
  declare data_types: any;

  @prop({
    type: "str",
    default: "RU",
    title: "Country Code",
    description: "Country code for trends (US, RU, GB, DE, FR, etc.)"
  })
  declare country_code: any;

  @prop({
    type: "str",
    default: "7",
    title: "Time Period",
    description: "Time period for trends: 7 (week), 30 (month), 120 (4 months)"
  })
  declare time_period: any;

  @prop({
    type: "int",
    default: 20,
    title: "Max Results",
    description: "Maximum number of results per data type"
  })
  declare max_results: any;

  @prop({
    type: "int",
    default: 300,
    title: "Wait For Finish",
    description: "Maximum time to wait for scraping to complete (seconds)"
  })
  declare wait_for_finish: any;

  async process(): Promise<Record<string, unknown>> {
    const apiKey = getApifyApiKey(this._secrets);
    const dataTypes = (this.data_types as string[]) ?? ["hashtags", "videos"];

    const runInput: Record<string, unknown> = {
      country: String(this.country_code ?? "RU").toUpperCase(),
      period: String(this.time_period ?? "7"),
      maxItems: Number(this.max_results ?? 20),
      // Enable requested data types
      scrapeHashtags: dataTypes.includes("hashtags"),
      scrapeSounds: dataTypes.includes("sounds"),
      scrapeCreators: dataTypes.includes("creators"),
      scrapeVideos: dataTypes.includes("videos")
    };

    const items = await runActor(
      apiKey,
      "automation-lab/tiktok-trends-scraper",
      runInput,
      Number(this.wait_for_finish ?? 300)
    );
    return { output: items };
  }
}

export const APIFY_NODES = tagAsServer([
  ApifyWebScraperNode,
  ApifyGoogleSearchScraperNode,
  ApifyInstagramScraperNode,
  ApifyInstagramTrendsScraperNode,
  ApifyAmazonScraperNode,
  ApifyYouTubeScraperNode,
  ApifyTwitterScraperNode,
  ApifyLinkedInScraperNode,
  ApifyTikTokScraperNode,
  ApifyTikTokTrendsScraperNode
]);
