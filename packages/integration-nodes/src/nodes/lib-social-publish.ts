import { BaseNode, prop } from "@nodetool-ai/node-sdk";
import { tagAsServer } from "@nodetool-ai/nodes-utils";

const TIMEOUT = 180000; // 3 minutes for video uploads

/**
 * Zernio API integration for social media publishing.
 * Supports Instagram, TikTok, YouTube, and Pinterest.
 *
 * Requires ZERNIO_API_KEY configured in Settings.
 */

function getZernioUrl(): string {
  return process.env.ZERNIO_API_URL ?? "https://api.zernio.com/v1";
}

function getZernioApiKey(secrets: Record<string, string>): string {
  const key = secrets?.ZERNIO_API_KEY || process.env.ZERNIO_API_KEY || "";
  if (!key) {
    throw new Error("ZERNIO_API_KEY is not configured. Add it in Settings → API Keys.");
  }
  return key;
}

function getZernioHeaders(secrets: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${getZernioApiKey(secrets)}`,
    "Content-Type": "application/json"
  };
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout: number = TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Get Connected Accounts
// ---------------------------------------------------------------------------

interface ZernioAccount {
  id: string;
  platform: string;
  username: string;
  followers: number;
  trialEligible: boolean;
}

export class ZernioGetAccountsNode extends BaseNode {
  static readonly nodeType = "lib.social.ZernioGetAccounts";
  static readonly title = "Zernio: Get Accounts";
  static readonly description =
    "Get connected social media accounts from Zernio.\n    social, zernio, accounts, instagram, tiktok, youtube, pinterest";
  static readonly metadataOutputTypes = {
    accounts: "list",
    count: "int"
  };
  static readonly inlineFields = [];
  static readonly inputFields = [];
  static readonly requiredSettings = ["ZERNIO_API_KEY"];

  async process(): Promise<Record<string, unknown>> {
    const headers = getZernioHeaders(this._secrets);
    const res = await fetchWithTimeout(
      `${getZernioUrl()}/accounts`,
      { method: "GET", headers },
      30000
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Zernio accounts failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const raw = data.accounts ?? data ?? [];

    const accounts: ZernioAccount[] = raw.map((a: Record<string, unknown>) => {
      const followers = extractFollowers(a);
      return {
        id: (a._id ?? a.id) as string,
        platform: a.platform as string,
        username: (a.username ?? a.displayName) as string,
        followers,
        trialEligible: followers === 0 || followers >= 1000
      };
    });

    return { accounts, count: accounts.length };
  }
}

function extractFollowers(account: Record<string, unknown>): number {
  for (const key of ["followersCount", "followers", "followerCount", "followers_count"]) {
    const val = account[key];
    if (typeof val === "number") return Math.floor(val);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Publish Video
// ---------------------------------------------------------------------------

type Platform = "instagram" | "tiktok" | "youtube" | "pinterest";

interface PlatformTarget {
  platform: Platform;
  accountId: string;
  platformSpecificData?: Record<string, unknown>;
}

export class ZernioPublishVideoNode extends BaseNode {
  static readonly nodeType = "lib.social.ZernioPublishVideo";
  static readonly title = "Zernio: Publish Video";
  static readonly description =
    "Publish a video to social media platforms via Zernio.\n    social, zernio, publish, video, instagram, tiktok, youtube, pinterest, reels, shorts, persona";
  static readonly metadataOutputTypes = {
    postId: "str",
    status: "str",
    scheduledFor: "str",
    message: "str"
  };
  static readonly inlineFields = ["caption"];
  static readonly inputFields = ["video"];
  static readonly requiredSettings = ["ZERNIO_API_KEY"];

  @prop({
    type: "video",
    default: null,
    title: "Video",
    description: "Video to publish"
  })
  declare video: { uri: string } | null;

  @prop({
    type: "str",
    default: "",
    title: "Caption",
    description: "Post caption/description"
  })
  declare caption: string;

  @prop({
    type: "image",
    default: null,
    title: "Cover Image",
    description: "Optional cover/thumbnail image"
  })
  declare coverImage: { uri: string } | null;

  @prop({
    type: "str",
    default: "",
    title: "Persona",
    description: "Select a persona to use its platform accounts. Manual account IDs below override persona settings.",
    json_schema_extra: { type: "persona_id" }
  })
  declare personaId: string;

  @prop({
    type: "str",
    default: "",
    title: "Instagram Account ID",
    description: "Instagram account ID to publish to (leave empty to skip, or use persona)"
  })
  declare instagramAccountId: string;

  @prop({
    type: "str",
    default: "",
    title: "TikTok Account ID",
    description: "TikTok account ID to publish to (leave empty to skip, or use persona)"
  })
  declare tiktokAccountId: string;

  @prop({
    type: "str",
    default: "",
    title: "YouTube Account ID",
    description: "YouTube account ID to publish to (leave empty to skip, or use persona)"
  })
  declare youtubeAccountId: string;

  @prop({
    type: "str",
    default: "",
    title: "Pinterest Account ID",
    description: "Pinterest account ID to publish to (leave empty to skip, or use persona)"
  })
  declare pinterestAccountId: string;

  @prop({
    type: "str",
    default: "",
    title: "Pinterest Board ID",
    description: "Pinterest board ID (required if publishing to Pinterest)"
  })
  declare pinterestBoardId: string;

  @prop({
    type: "str",
    default: "",
    title: "Pinterest Link",
    description: "Optional link for Pinterest pin"
  })
  declare pinterestLink: string;

  @prop({
    type: "str",
    default: "",
    title: "Scheduled For",
    description: "ISO8601 datetime for scheduled publishing (leave empty for immediate)"
  })
  declare scheduledFor: string;

  @prop({
    type: "str",
    default: "Europe/Moscow",
    title: "Timezone",
    description: "Timezone for scheduled publishing"
  })
  declare timezone: string;

  @prop({
    type: "str",
    default: "off",
    title: "Instagram Trial Reels",
    description: "Trial Reels mode: off, auto (SS_PERFORMANCE), or manual"
  })
  declare trialMode: string;

  @prop({
    type: "bool",
    default: true,
    title: "AI Generated Label",
    description: "Mark content as AI-generated (required by some platforms)"
  })
  declare isAiGenerated: boolean;

  async process(): Promise<Record<string, unknown>> {
    if (!this.video?.uri) {
      throw new Error("Video is required");
    }

    const platforms = this.buildPlatforms();
    if (platforms.length === 0) {
      throw new Error("At least one platform account ID is required");
    }

    const headers = getZernioHeaders(this._secrets);

    // Step 1: Presign URL for video upload
    const presignRes = await fetchWithTimeout(
      `${getZernioUrl()}/media/presign`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ filename: "video.mp4", contentType: "video/mp4" })
      },
      30000
    );

    if (!presignRes.ok) {
      const text = await presignRes.text();
      throw new Error(`Zernio presign failed (${presignRes.status}): ${text.slice(0, 200)}`);
    }

    const presignData = await presignRes.json();
    const { uploadUrl, publicUrl } = presignData;

    // Step 2: Upload video
    const videoData = await this.fetchVideoData(this.video.uri);
    const uploadRes = await fetchWithTimeout(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "video/mp4" },
      body: videoData
    });

    if (!uploadRes.ok) {
      throw new Error(`Zernio video upload failed (${uploadRes.status})`);
    }

    // Step 3: Upload cover image if provided
    let coverUrl: string | undefined;
    if (this.coverImage?.uri) {
      const coverPresignRes = await fetchWithTimeout(
        `${getZernioUrl()}/media/presign`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ filename: "cover.jpg", contentType: "image/jpeg" })
        },
        30000
      );

      if (coverPresignRes.ok) {
        const coverPresignData = await coverPresignRes.json();
        const coverData = await this.fetchImageData(this.coverImage.uri);
        const coverUploadRes = await fetchWithTimeout(coverPresignData.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "image/jpeg" },
          body: coverData
        });

        if (coverUploadRes.ok) {
          coverUrl = coverPresignData.publicUrl;
        }
      }
    }

    // Step 4: Create post
    const postBody: Record<string, unknown> = {
      content: this.caption,
      mediaItems: [{ url: publicUrl, type: "video" }],
      platforms
    };

    if (this.scheduledFor) {
      postBody.scheduledFor = this.scheduledFor;
      postBody.timezone = this.timezone;
    } else {
      postBody.publishNow = true;
    }

    // Add cover URL to Instagram platform if available
    if (coverUrl) {
      const igPlatform = platforms.find((p) => p.platform === "instagram");
      if (igPlatform?.platformSpecificData) {
        igPlatform.platformSpecificData.instagramThumbnail = coverUrl;
      }
    }

    const postRes = await fetchWithTimeout(
      `${getZernioUrl()}/posts`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(postBody)
      },
      60000
    );

    const postData = await postRes.json();
    const post = postData.post ?? postData ?? {};

    return {
      postId: (post.id ?? post._id ?? "") as string,
      status: (post.status ?? "") as string,
      scheduledFor: (post.scheduledFor ?? "") as string,
      message: (postData.message ?? postData.error ?? "") as string
    };
  }

  private buildPlatforms(): PlatformTarget[] {
    const platforms: PlatformTarget[] = [];

    if (this.instagramAccountId) {
      const platformSpecificData: Record<string, unknown> = {
        contentType: "reels",
        isAiGenerated: this.isAiGenerated
      };

      if (this.trialMode === "auto") {
        platformSpecificData.trialParams = { graduationStrategy: "SS_PERFORMANCE" };
      } else if (this.trialMode === "manual") {
        platformSpecificData.trialParams = { graduationStrategy: "MANUAL" };
      }

      platforms.push({
        platform: "instagram",
        accountId: this.instagramAccountId,
        platformSpecificData
      });
    }

    if (this.tiktokAccountId) {
      platforms.push({
        platform: "tiktok",
        accountId: this.tiktokAccountId,
        platformSpecificData: { isAiGenerated: this.isAiGenerated }
      });
    }

    if (this.youtubeAccountId) {
      platforms.push({
        platform: "youtube",
        accountId: this.youtubeAccountId,
        platformSpecificData: { privacyStatus: "public" }
      });
    }

    if (this.pinterestAccountId) {
      platforms.push({
        platform: "pinterest",
        accountId: this.pinterestAccountId,
        platformSpecificData: {
          boardId: this.pinterestBoardId,
          link: this.pinterestLink || undefined
        }
      });
    }

    return platforms;
  }

  private async fetchVideoData(uri: string): Promise<ArrayBuffer> {
    const res = await fetchWithTimeout(uri, { method: "GET" }, TIMEOUT);
    if (!res.ok) {
      throw new Error(`Failed to fetch video: ${res.status}`);
    }
    return res.arrayBuffer();
  }

  private async fetchImageData(uri: string): Promise<ArrayBuffer> {
    const res = await fetchWithTimeout(uri, { method: "GET" }, 30000);
    if (!res.ok) {
      throw new Error(`Failed to fetch image: ${res.status}`);
    }
    return res.arrayBuffer();
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const LIB_SOCIAL_PUBLISH_NODES = tagAsServer([
  ZernioGetAccountsNode,
  ZernioPublishVideoNode
]);
