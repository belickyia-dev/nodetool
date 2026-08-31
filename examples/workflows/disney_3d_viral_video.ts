/**
 * Disney 3D Viral Video Generator
 *
 * Creates viral short-form videos in Disney/Pixar 3D style using Seedance 2.0.
 *
 * Workflow:
 * 1. Generate Disney 3D style character image from prompt
 * 2. Pass to Seedance 2.0 reference-to-video
 * 3. Output animated video with generated audio
 *
 * Viral mechanics built-in:
 * - 9:16 vertical format (TikTok/Reels/Shorts)
 * - Disney 3D style (big eyes, glossy skin, cinematic lighting)
 * - Generated audio for engagement
 */

import { workflow, createNode, type SingleOutput } from "@nodetool-ai/dsl";
import type { ImageRef, VideoRef } from "@nodetool-ai/dsl";

// Step 1: Generate Disney 3D style character
function fluxDev(inputs: { prompt: string; image_size?: string }) {
  return createNode<SingleOutput<ImageRef>>(
    "fal.text_to_image.FluxDev",
    inputs as Record<string, unknown>
  );
}

// Step 2: Generate video from reference images
function seedanceReferenceToVideo(inputs: {
  images: ImageRef[];
  prompt: string;
  aspect_ratio?: string;
  duration?: string;
  generate_audio?: boolean;
  resolution?: string;
}) {
  return createNode<SingleOutput<VideoRef>>(
    "fal.image_to_video.BytedanceSeedance20ReferenceToVideo",
    inputs as Record<string, unknown>
  );
}

// ============================================================================
// CONCEPT 1: Cartoon Twin Transformation
// ============================================================================

// Disney 3D style prompt template
const disney3DStylePrompt = `
3D Disney Pixar animated character style.
Large expressive eyes with detailed iris reflections and catchlights.
Smooth, slightly glossy skin with soft subsurface scattering.
Doll-like aesthetic, plastic texture.
Stylized but human-like proportions.
Soft diffused studio lighting with key light and rim light.
Cinematic quality, feature film render.
Happy, warm, friendly expression.
Full body visible, arms and hands clear.
Green screen background for compositing.
`.trim();

// Generate the Disney 3D character image
const characterImage = fluxDev({
  prompt: `A young woman with long brown hair, trendy blue sweater, dancing pose. ${disney3DStylePrompt}`,
  image_size: "portrait_16_9", // 9:16 for vertical video
});

// Generate the viral video with transformation effect
const viralVideo = seedanceReferenceToVideo({
  images: [characterImage.output as unknown as ImageRef],
  prompt: `
@Image1 is a 3D Disney Pixar character that comes to life.
The character dances playfully with happy expressions.
Big smile, expressive movements, hands visible the entire video.
The character does a fun celebratory dance, ending with a wink at the camera.
Magical sparkles appear around the character.
Cinematic lighting, smooth motion, high energy.
  `.trim(),
  aspect_ratio: "9:16",
  duration: "10",
  generate_audio: true,
  resolution: "720p",
});

// ============================================================================
// Export workflow
// ============================================================================

const wf = workflow(viralVideo);
console.log(JSON.stringify(wf));
