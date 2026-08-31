/**
 * PixUp Instagram Reels Publisher
 *
 * Takes S3 image URLs, converts to video, publishes to Instagram Reels.
 *
 * Usage:
 *   npm run dev:nodetool -- run examples/workflows/pixup-reels-publisher.ts \
 *     --params '{"image_url": "https://s3.amazonaws.com/bucket/image.jpg", "caption": "AI magic!"}'
 *
 * Or batch via CLI loop:
 *   for url in $(cat urls.txt); do
 *     npm run dev:nodetool -- run examples/workflows/pixup-reels-publisher.ts \
 *       --params "{\"image_url\": \"$url\", \"caption\": \"Check this out!\"}"
 *   done
 */

import { workflow, createNode, type SingleOutput } from "@nodetool-ai/dsl";
import type { ImageRef, VideoRef } from "@nodetool-ai/dsl";

// Input: Load image from URL
function loadImageFromUrl(inputs: { url: string }) {
  return createNode<SingleOutput<ImageRef>>(
    "nodetool.input.ImageInput",
    { value: { type: "image", uri: inputs.url } }
  );
}

// Option A: AI-powered video generation (Veo, Kling, etc.)
function imageToVideo(inputs: {
  image: ImageRef;
  prompt: string;
  duration?: number;
  aspect_ratio?: string;
}) {
  return createNode<SingleOutput<VideoRef>>(
    "nodetool.video.ImageToVideo",
    {
      image: [inputs.image],
      prompt: inputs.prompt,
      duration: inputs.duration ?? 4,
      aspect_ratio: inputs.aspect_ratio ?? "9:16",
      resolution: "1080p",
      model: {
        type: "video_model",
        provider: "fal_ai",
        id: "fal-ai/kling-video/v2.1/standard/image-to-video",
        name: "Kling 2.1",
        path: null,
        supported_tasks: []
      }
    }
  );
}

// Option B: Remotion HookReveal (simpler, cheaper)
function remotionHookReveal(inputs: {
  before_image: ImageRef;
  after_image: ImageRef;
  hook_text: string;
}) {
  return createNode<SingleOutput<VideoRef>>(
    "nodetool.video.RemotionRender",
    {
      template: "HookReveal",
      before_image: inputs.before_image,
      after_image: inputs.after_image,
      hook_text: inputs.hook_text,
      duration_frames: 90,
      fps: 30,
      width: 1080,
      height: 1920,
      server_url: "http://localhost:3333"
    }
  );
}

// Publish to Instagram Reels via Zernio
function publishToInstagram(inputs: {
  video: VideoRef;
  caption: string;
  instagram_account_id: string;
}) {
  return createNode<SingleOutput<{ postId: string; status: string }>>(
    "lib.social.ZernioPublishVideo",
    {
      video: inputs.video,
      caption: inputs.caption,
      instagramAccountId: inputs.instagram_account_id,
      isAiGenerated: true,
      trialMode: "auto"
    }
  );
}

// ============================================================================
// WORKFLOW: Image URL → AI Video → Instagram Reel
// ============================================================================

// Workflow inputs (passed via --params)
const IMAGE_URL = "{{image_url}}";  // S3 URL
const CAPTION = "{{caption}}";       // Post caption
const INSTAGRAM_ACCOUNT_ID = "{{instagram_account_id}}"; // From Zernio

// Step 1: Load image from S3 URL
const sourceImage = loadImageFromUrl({ url: IMAGE_URL });

// Step 2: Generate video with AI animation
const video = imageToVideo({
  image: sourceImage.output as unknown as ImageRef,
  prompt: `
    Subtle cinematic motion. Gentle zoom in with parallax depth effect.
    Soft lighting changes. Professional quality, smooth movement.
    Instagram Reels style, engaging and eye-catching.
  `.trim(),
  duration: 5,
  aspect_ratio: "9:16"
});

// Step 3: Publish to Instagram
const published = publishToInstagram({
  video: video.output as unknown as VideoRef,
  caption: CAPTION,
  instagram_account_id: INSTAGRAM_ACCOUNT_ID
});

// Export workflow
const wf = workflow(published);
console.log(JSON.stringify(wf));
