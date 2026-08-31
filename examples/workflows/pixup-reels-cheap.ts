/**
 * PixUp Instagram Reels Publisher (Cheap Version)
 *
 * Uses Remotion for simple Ken Burns / zoom effect instead of AI video generation.
 * Cost: ~$0 per video (only Remotion server CPU)
 *
 * Requires Remotion server running:
 *   npx tsx demo/server.ts
 *
 * Usage:
 *   npm run dev:nodetool -- run examples/workflows/pixup-reels-cheap.ts \
 *     --params '{"image_url": "https://s3.../image.jpg", "hook_text": "Wait for it...", "caption": "AI art!"}'
 */

import { workflow, createNode, type SingleOutput } from "@nodetool-ai/dsl";
import type { ImageRef, VideoRef } from "@nodetool-ai/dsl";

// Load image from URL
function loadImageFromUrl(inputs: { url: string }) {
  return createNode<SingleOutput<ImageRef>>(
    "nodetool.input.ImageInput",
    { value: { type: "image", uri: inputs.url } }
  );
}

// Remotion HookReveal template - creates engaging before/after video
function remotionHookReveal(inputs: {
  before_image: ImageRef;
  after_image: ImageRef;
  hook_text: string;
  duration_frames?: number;
}) {
  return createNode<SingleOutput<VideoRef>>(
    "nodetool.video.RemotionRender",
    {
      template: "HookReveal",
      before_image: inputs.before_image,
      after_image: inputs.after_image,
      hook_text: inputs.hook_text,
      duration_frames: inputs.duration_frames ?? 90, // 3 seconds at 30fps
      fps: 30,
      width: 1080,
      height: 1920, // 9:16 vertical for Reels
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
// WORKFLOW: Image → Remotion Video → Instagram Reel
// ============================================================================

// Inputs
const IMAGE_URL = "{{image_url}}";
const HOOK_TEXT = "{{hook_text}}";  // e.g. "Wait for it... 👀"
const CAPTION = "{{caption}}";
const INSTAGRAM_ACCOUNT_ID = "{{instagram_account_id}}";

// Load image (used as both before and after - HookReveal adds blur/reveal effect)
const image = loadImageFromUrl({ url: IMAGE_URL });

// Create video with HookReveal effect
// Before: blurred version with hook text
// After: revealed clear image
const video = remotionHookReveal({
  before_image: image.output as unknown as ImageRef,
  after_image: image.output as unknown as ImageRef,
  hook_text: HOOK_TEXT,
  duration_frames: 90
});

// Publish
const published = publishToInstagram({
  video: video.output as unknown as VideoRef,
  caption: CAPTION,
  instagram_account_id: INSTAGRAM_ACCOUNT_ID
});

const wf = workflow(published);
console.log(JSON.stringify(wf));
