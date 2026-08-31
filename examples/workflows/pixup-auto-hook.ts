/**
 * PixUp Auto Hook Generator + Instagram Publisher
 *
 * Takes S3 image URL, prompt, and title → Analyzes image → Generates hook text
 * in competitor style → Creates HookReveal video → Publishes to Instagram.
 *
 * Based on analysis of Russian AI-photo accounts (@neiro.phot style):
 * - Hook patterns: "Смотри до конца 👀", "Вот результат 👇", "Спорим, не знал..."
 * - Font: Large, bold, white with dark stroke
 * - Transition: blur → reveal (5-15 sec optimal)
 * - Tone: Intriguing, emotional, question-based
 *
 * Requires:
 *   - Remotion server: npx tsx demo/server.ts (port 3333)
 *   - Zernio API key: npm run dev:nodetool -- secrets store ZERNIO_API_KEY
 *
 * Usage:
 *   npm run dev:nodetool -- run examples/workflows/pixup-auto-hook.ts \
 *     --params '{
 *       "image_url": "https://s3.../result.jpg",
 *       "prompt": "девушка в стиле киберпанк",
 *       "title": "Киберпанк портрет",
 *       "instagram_account_id": "YOUR_ZERNIO_ACCOUNT_ID"
 *     }'
 */

import { workflow, createNode, type SingleOutput } from "@nodetool-ai/dsl";
import type { ImageRef, VideoRef } from "@nodetool-ai/dsl";

// ============================================================================
// HELPER NODES
// ============================================================================

// Load image from URL
function loadImageFromUrl(inputs: { url: string }) {
  return createNode<SingleOutput<ImageRef>>(
    "nodetool.input.ImageInput",
    { value: { type: "image", uri: inputs.url } }
  );
}

// Agent for analyzing image and generating hook text
function generateHookText(inputs: {
  image: ImageRef;
  prompt: string;
  title: string;
}) {
  const systemPrompt = `Ты — эксперт по созданию вирусных Instagram Reels в стиле русскоязычных AI-фото аккаунтов.

Твоя задача: создать короткий hook-текст (1-5 слов + эмодзи) для видео с AI-фото.

СТИЛЬ ТЕКСТА (на основе анализа конкурентов):
- Интригующий, вызывает желание досмотреть
- Эмоциональный, но не кликбейтный
- Использует вопросы или незаконченные фразы
- Включает 1-2 эмодзи

ПРИМЕРЫ ХОРОШИХ ХУКОВ:
- "Смотри до конца 👀"
- "Вот результат 👇"
- "Как это сделать? 🤔"
- "Спорим, не знал... 😏"
- "Подожди 3 секунды ⏰"
- "Это нейросеть 🤖"
- "Было vs Стало 🔥"
- "Ты не поверишь... 😱"

ПРАВИЛА:
1. Текст должен быть на русском языке
2. Максимум 5 слов (без учёта эмодзи)
3. Должен создавать интригу
4. Не повторяй заголовок буквально
5. Отвечай ТОЛЬКО текстом хука, без объяснений`;

  const userPrompt = `Создай hook-текст для AI-фото.

Описание изображения: ${inputs.prompt}
Заголовок поста: ${inputs.title}

Изображение прикреплено. Проанализируй его и создай интригующий hook.

Ответь ТОЛЬКО текстом хука (1-5 слов + эмодзи):`;

  return createNode<{ text: string }>(
    "nodetool.agents.Agent",
    {
      model: {
        type: "language_model",
        provider: "anthropic",
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        path: null,
        supported_tasks: []
      },
      mode: "loop",
      system: systemPrompt,
      prompt: userPrompt,
      image: [inputs.image],
      max_tokens: 100,
      max_turns: 1
    }
  );
}

// Remotion HookReveal template
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
// WORKFLOW: URL + Prompt + Title → Hook Generation → Video → Instagram
// ============================================================================

// Inputs (passed via --params)
const IMAGE_URL = "{{image_url}}";      // S3 URL of the result image
const PROMPT = "{{prompt}}";            // Original generation prompt
const TITLE = "{{title}}";              // Post title from database
const INSTAGRAM_ACCOUNT_ID = "{{instagram_account_id}}";

// Step 1: Load image
const image = loadImageFromUrl({ url: IMAGE_URL });

// Step 2: Generate hook text using LLM (analyzes image + prompt + title)
const hookGeneration = generateHookText({
  image: image.output as unknown as ImageRef,
  prompt: PROMPT,
  title: TITLE
});

// Step 3: Create video with HookReveal effect
// Uses the same image for before (blurred) and after (revealed)
const video = remotionHookReveal({
  before_image: image.output as unknown as ImageRef,
  after_image: image.output as unknown as ImageRef,
  hook_text: hookGeneration.text as unknown as string,
  duration_frames: 90  // 3 seconds
});

// Step 4: Build caption with hashtags
const caption = `${TITLE}

${PROMPT}

#нейросеть #aiart #нейрофото #искусственныйинтеллект #нейроарт
#aiartwork #digitalart #pixup #aiфото #нейропортрет`;

// Step 5: Publish to Instagram
const published = publishToInstagram({
  video: video.output as unknown as VideoRef,
  caption: caption,
  instagram_account_id: INSTAGRAM_ACCOUNT_ID
});

// Export workflow
const wf = workflow(published);
console.log(JSON.stringify(wf));
