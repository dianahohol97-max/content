/**
 * bloom focus — text-generator.js
 * Calls Claude API to generate the full weekly content pack.
 *
 * Output per run:
 *   - 5 video scripts (one per pillar)
 *   - 5 TikTok captions (with hashtags)
 *   - 5 IG captions (no hashtags)
 *   - 2 carousel text sets (7 slides each)
 *   - 7 Stories copy (one per day)
 *   - 5 Pinterest descriptions
 *   - 1 DALL-E image prompt per post
 *
 * Usage:
 *   node bloom/text-generator.js --week=26
 *   node bloom/text-generator.js --week=26 --pillar=2
 */

import 'dotenv/config';
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const _raw = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../projects.json"), "utf-8")
);
const config = _raw.bloom_focus ?? _raw.projects?.bloom_focus;

if (!config) {
  console.error("❌ bloom_focus config not found in projects.json");
  process.exit(1);
}

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.slice(2).split("=");
      return [k, v ?? true];
    })
);

const WEEK = args.week ? parseInt(args.week) : getCurrentWeekNumber();
const SINGLE_PILLAR = args.pillar ? parseInt(args.pillar) : null;

function getCurrentWeekNumber() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
}

// ─── Normalize pillars from projects.json format ──────────────────────────────
// projects.json uses content_pillars: { pillar_1: {...}, pillar_2: {...} }
const PILLARS = Object.entries(config.content_pillars).map(([key, p], i) => ({
  id: i + 1,
  key: p.id,
  name: p.label,
  type: p.type,
  goal: p.goal,
  formats: p.formats ?? [],
  always_quiz: p.always_end_with_quiz_cta ?? false,
  hooks: config.hook_library?.reframe ?? [],
}));

const HASHTAGS = [
  "#ADHD", "#ADHDbrain", "#neurodivergent", "#ADHDtips", "#adhdlife",
  "#adhdawareness", "#adhdproductivity", "#neurodivergentlife",
  "#adhdcommunity", "#bloomfocus"
];

// ─── System prompt ────────────────────────────────────────────────────────────

// ─── Safe JSON parse (strips markdown code fences if present) ────────────────
function parseJSON(text) {
  // Strip markdown fences
  let cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  // Find JSON object boundaries
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    cleaned = cleaned.slice(start, end + 1);
  }
  // Fix common JSON issues: replace curly quotes with straight quotes
  cleaned = cleaned
    .replace(/[\u2018\u2019]/g, "\'")
    .replace(/[\u201C\u201D]/g, '\"')
    .replace(/[\u2013\u2014]/g, '-');
  try {
    return JSON.parse(cleaned);
  } catch(e) {
    // Last resort: remove control characters
    cleaned = cleaned.replace(/[\x00-\x1F\x7F]/g, ' ');
    return JSON.parse(cleaned);
  }
}

const SYSTEM_PROMPT = `You are the content writer for bloom focus, an ADHD digital products brand.

BRAND VOICE: "${config.tone.secondary}"
TONE: ${config.tone.primary}

NEVER SAY: ${(config.tone.never ?? []).join(", ")}
FORBIDDEN PHRASES: ${(config.forbidden_phrases ?? []).join(", ")}

PRODUCTS: ${config.products.join(", ")}
QUIZ URL: ${config.quiz_url}

RULES:
- Always name the real ADHD experience BEFORE offering the solution
- Reference neuroscience simply ("your brain needs a dopamine hit to start")
- Validate before educating
- Make people feel seen, not broken
- Humor welcome — never at ADHD's expense
- Never use the word "hack"
- Content is English only

OUTPUT: Return ONLY valid JSON. No markdown, no backticks, no preamble. Use only straight double quotes for JSON. No apostrophes in values — replace with spaces or rephrase.`;

// ─── Generate video script ────────────────────────────────────────────────────
async function generateVideoScript(pillar, weekNumber, videoIndex) {
  const isQuizVideo = videoIndex % (config.quiz_inject_every_n_videos ?? 3) === 0;

  const prompt = `Generate a TikTok/Instagram Reel video script for bloom focus.

PILLAR: ${pillar.name} (${pillar.type})
GOAL: ${pillar.goal}
WEEK: ${weekNumber}
VIDEO INDEX: ${videoIndex}
${isQuizVideo ? `CTA: End with quiz → ${config.quiz_url}` : "CTA: Save this + share"}

SCRIPT STRUCTURE:
- HOOK (0-3s): Specific ADHD experience or brain fact. Must stop scroll immediately.
- BRIDGE (3-8s): Why this happens — neuroscience, kept simple
- BODY (8-45s): 3-4 concrete points — what actually helps OR relatable validation
- CTA (last 5s): ${isQuizVideo ? `Take the free quiz → ${config.quiz_url}` : "Save this + share with someone who needs it"}

Return this exact JSON:
{
  "pillar_id": ${pillar.id},
  "pillar_name": "${pillar.name}",
  "video_index": ${videoIndex},
  "hook": "the hook line (0-3s)",
  "bridge": "the bridge line (3-8s)",
  "body": ["point 1", "point 2", "point 3", "point 4"],
  "cta": "the closing CTA",
  "on_screen_text": "short bold overlay text (max 8 words)",
  "is_quiz_video": ${isQuizVideo}
}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  return parseJSON(response.content[0].text);
}

// ─── Generate captions ────────────────────────────────────────────────────────
async function generateCaptions(script, pillar) {
  const prompt = `Generate two captions for a bloom focus video.

HOOK: "${script.hook}"
CTA: "${script.cta}"
PILLAR: ${pillar.name}

Return this exact JSON:
{
  "tiktok_caption": "hook sentence\\n\\n1-2 sentence expansion\\n\\n${script.cta}\\n\\n${HASHTAGS.join(" ")}",
  "ig_caption": "hook sentence\\n\\n1-2 sentence expansion\\n\\n${script.cta}"
}

Rules:
- TikTok: include hashtags at the end
- IG: NO hashtags
- Both under 150 words (before hashtags)`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  return parseJSON(response.content[0].text);
}

// ─── Generate carousel ────────────────────────────────────────────────────────
async function generateCarousel(pillar, weekNumber, type) {
  const product = config.products[Math.floor(Math.random() * config.products.length)];

  const prompt = type === "product"
    ? `Generate a 7-slide product carousel for bloom focus.
PRODUCT: ${product}

Slides: 1) Problem, 2) Why existing solutions fail ADHD, 3) Introduce product,
4-5) How it works specifically, 6) Before/After, 7) Link in bio CTA

Return JSON: { "carousel_type": "product", "product": "${product}", "slides": [{"slide":1,"title":"...","body":"..."},{"slide":2,"title":"...","body":"..."},{"slide":3,"title":"...","body":"..."},{"slide":4,"title":"...","body":"..."},{"slide":5,"title":"...","body":"..."},{"slide":6,"title":"...","body":"..."},{"slide":7,"title":"...","body":"..."}] }`
    : `Generate a 7-slide educational carousel for bloom focus.
PILLAR: ${pillar.name}, WEEK: ${weekNumber}

Slides: 1) Bold hook + "Save this", 2-6) One concept each (numbered, title + 2-3 lines), 7) Summary + CTA

Return JSON: { "carousel_type": "educational", "topic": "the main topic", "slides": [{"slide":1,"title":"...","body":"..."},{"slide":2,"title":"...","body":"..."},{"slide":3,"title":"...","body":"..."},{"slide":4,"title":"...","body":"..."},{"slide":5,"title":"...","body":"..."},{"slide":6,"title":"...","body":"..."},{"slide":7,"title":"...","body":"..."}] }`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  return parseJSON(response.content[0].text);
}

// ─── Generate Stories ─────────────────────────────────────────────────────────
async function generateStories(weekNumber) {
  const prompt = `Generate 7 Instagram Stories for bloom focus, one per day.
WEEK: ${weekNumber}

Schedule: Mon=Poll, Tue=Tip, Wed=BTS, Thu=Quiz (must end: ${config.quiz_url}), Fri=Product, Sat=Q&A, Sun=Reflection

Return JSON:
{
  "week": ${weekNumber},
  "stories": [
    {"day":"monday","type":"Poll","headline":"(max 10 words)","poll_option_1":"...","poll_option_2":"...","note":"IG poll sticker"},
    {"day":"tuesday","type":"Tip","headline":"(max 8 words)","body":"1-2 sentences","note":"text on pastel bg"},
    {"day":"wednesday","type":"BTS","headline":"(max 10 words)","body":"1-2 sentences","note":"text card"},
    {"day":"thursday","type":"Quiz","headline":"(max 10 words)","body":"1 sentence","cta":"${config.quiz_url}","note":"link sticker"},
    {"day":"friday","type":"Product","product":"product name","headline":"(max 10 words)","body":"1-2 sentences","note":"image + text"},
    {"day":"saturday","type":"QA","question":"open question (max 12 words)","note":"Q&A sticker"},
    {"day":"sunday","type":"Reflection","headline":"(max 10 words)","body":"1 soft sentence","note":"calm energy"}
  ]
}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  return parseJSON(response.content[0].text);
}

// ─── Generate Pinterest descriptions ─────────────────────────────────────────
async function generatePinterestDescriptions(scripts, weekNumber) {
  const prompt = `Generate 5 Pinterest pin descriptions for bloom focus.
WEEK: ${weekNumber}

Based on these hooks:
${scripts.map((s, i) => `${i + 1}. "${s.hook}" (${s.pillar_name})`).join("\n")}

Rules: keyword-rich, SEO-focused, evergreen, 2-3 sentences, link to bloomfocus.org or Etsy. CRITICAL: Use only plain ASCII text. No apostrophes, no curly quotes, no special characters anywhere in the JSON values.

Return JSON:
{
  "week": ${weekNumber},
  "pins": [
    {"pin_number":1,"title":"keyword-rich title","description":"2-3 sentences","link":"bloomfocus.org","keywords":["kw1","kw2","kw3"]},
    {"pin_number":2,"title":"...","description":"...","link":"...","keywords":[]},
    {"pin_number":3,"title":"...","description":"...","link":"...","keywords":[]},
    {"pin_number":4,"title":"...","description":"...","link":"...","keywords":[]},
    {"pin_number":5,"title":"...","description":"...","link":"...","keywords":[]}
  ]
}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  return parseJSON(response.content[0].text);
}

// ─── Generate DALL-E / Imagen image prompts ───────────────────────────────────
function generateImagePrompts(scripts, carousels, weekNumber) {
  const BASE = `Soft pastel digital illustration in a cozy, approachable style. Color palette: lavender #E8DEFF, cream #FFF8F0, sage green #D4E8D4, blush #FFD4E4, sky blue #D4EEFF. Flat vector illustration with soft watercolor texture. Warm, calm, friendly feeling. No real people, no photos. No text, no words, no letters in the image.`;

  const ADDITIONS = {
    1: "Abstract brain concept — neurons firing, thought bubbles, stylized brain. Prefer metaphorical (lightbulb, clouds, sparks) over literal brain imagery.",
    2: "Cozy comfort scene — illustrated person wrapped in blanket, warm tea, softly lit desk. Feeling of being understood and safe.",
    3: "Organized calm workspace or open planner with simple illustrated elements. Clean, achievable, not overwhelming. One focal point.",
    4: "Interactive feel — checklist graphic, quiz-style layout, simple Y/N visual. Engaging and curious, not clinical.",
    5: "Specific product illustrated — planner open on desk, timer on table, menu pinned to wall. Context-rich but minimal.",
  };

  const prompts = [];

  for (const script of scripts) {
    prompts.push({
      id: `video_p${script.pillar_id}`,
      content_type: "video",
      aspect_ratio: "9:16",
      pillar: script.pillar_name,
      hook: script.hook,
      prompt: `${BASE} ${ADDITIONS[script.pillar_id] ?? ADDITIONS[1]} Vertical 9:16 format. Scene inspired by: "${script.hook}"`,
    });
  }

  for (const carousel of carousels) {
    const pid = carousel.carousel_type === "product" ? 5 : 1;
    const topic = carousel.carousel_type === "product" ? carousel.product : carousel.topic;
    prompts.push({
      id: `carousel_${carousel.carousel_type}`,
      content_type: "carousel_cover",
      aspect_ratio: "4:5",
      pillar: carousel.carousel_type === "product" ? "Behind the Product" : "This Is Your Brain",
      topic,
      prompt: `${BASE} ${ADDITIONS[pid]} 4:5 format. Scene related to: "${topic}"`,
    });
  }

  return { week: weekNumber, total: prompts.length, image_prompts: prompts };
}

// ─── Generate image prompts for Stories ──────────────────────────────────────
function generateStoryImagePrompts(stories, weekNumber) {
  const BASE = `Soft pastel digital illustration in a cozy, approachable style. Color palette: lavender #E8DEFF, cream #FFF8F0, sage green #D4E8D4, blush #FFD4E4, sky blue #D4EEFF. Flat vector illustration with soft watercolor texture. Warm, calm, friendly feeling. No real people, no photos. No text or words inside the image. Square 1:1 format for Instagram Stories card.`;

  const TYPE_ADDITIONS = {
    "Poll": "Two contrasting abstract elements suggesting a choice. Playful, light energy.",
    "Tip": "Single calm scene suggesting focus or clarity. Minimal, one focal point.",
    "BTS": "Cozy behind-the-scenes feel — soft desk, notebook, warm light.",
    "Quiz": "Curious, engaging visual — checklist, question mark motif, interactive feel.",
    "Product": "Illustrated product on a soft pastel desk. Planner or toolkit, warm and inviting.",
    "QA": "Open, curious feeling — speech bubble motif, soft warm tones.",
    "Reflection": "Gentle, calm scene — evening light, plant, cup of tea. Peaceful."
  };

  return stories.map((story, i) => ({
    id: `story_${story.day}`,
    content_type: "story_card",
    aspect_ratio: "1:1",
    day: story.day,
    type: story.type,
    headline: story.headline,
    prompt: `${BASE} ${TYPE_ADDITIONS[story.type] ?? ""} Scene inspired by: "${story.headline}"`,
  }));
}

// ─── Generate image prompts for Pinterest pins ────────────────────────────────
function generatePinterestImagePrompts(pins, weekNumber) {
  const BASE = `Soft pastel digital illustration in a cozy, approachable style. Color palette: lavender #E8DEFF, cream #FFF8F0, sage green #D4E8D4, blush #FFD4E4, sky blue #D4EEFF. Flat vector illustration with soft watercolor texture. Warm, calm, friendly feeling. No real people, no photos. No text or words inside the image. Vertical 2:3 format for Pinterest.`;

  return pins.map((pin, i) => ({
    id: `pinterest_pin_${pin.pin_number}`,
    content_type: "pinterest_pin",
    aspect_ratio: "2:3",
    title: pin.title,
    link: pin.link,
    prompt: `${BASE} Evergreen educational illustration. Scene inspired by ADHD topic: "${pin.title}". Infographic-style layout feel but no text. Calm workspace, brain concept, or organizational visual.`,
  }));
}

// ─── Main runner ──────────────────────────────────────────────────────────────
async function generateWeeklyPack(weekNumber) {
  console.log(`\n🌸 bloom focus — Week ${weekNumber} content pack\n`);
  console.log("━".repeat(50));

  const pillars = SINGLE_PILLAR
    ? PILLARS.filter((p) => p.id === SINGLE_PILLAR)
    : PILLARS;

  const results = {
    meta: {
      brand: "bloom_focus",
      week: weekNumber,
      generated_at: new Date().toISOString(),
      total_pieces: 0,
    },
    video_scripts: [],
    tiktok_captions: [],
    ig_captions: [],
    carousels: [],
    stories: null,
    pinterest: null,
    image_prompts: null,
  };

  // 1. Video scripts + captions
  console.log("📝 Generating video scripts...");
  for (let i = 0; i < pillars.length; i++) {
    const pillar = pillars[i];
    process.stdout.write(`   Pillar ${pillar.id}: ${pillar.name}... `);
    const script = await generateVideoScript(pillar, weekNumber, i + 1);
    results.video_scripts.push(script);

    const captions = await generateCaptions(script, pillar);
    results.tiktok_captions.push({ pillar_id: pillar.id, ...captions });
    results.ig_captions.push({ pillar_id: pillar.id, ig_caption: captions.ig_caption });
    console.log("✓");
  }

  // 2. Carousels
  console.log("\n🎠 Generating carousels...");
  process.stdout.write("   Educational... ");
  results.carousels.push(await generateCarousel(pillars[0], weekNumber, "educational"));
  console.log("✓");

  process.stdout.write("   Product... ");
  results.carousels.push(await generateCarousel(pillars[pillars.length - 1], weekNumber, "product"));
  console.log("✓");

  // 3. Stories
  console.log("\n📱 Generating Stories...");
  results.stories = await generateStories(weekNumber);
  console.log("   ✓ 7 stories");

  // 4. Pinterest
  console.log("\n📌 Generating Pinterest descriptions...");
  results.pinterest = await generatePinterestDescriptions(results.video_scripts, weekNumber);
  console.log("   ✓ 5 pins");

  // 5. Image prompts — videos + carousels
  console.log("\n🎨 Building image prompts...");
  results.image_prompts = generateImagePrompts(results.video_scripts, results.carousels, weekNumber);
  console.log(`   ✓ ${results.image_prompts.total} video/carousel prompts`);

  // 5b. Image prompts — Stories
  results.story_image_prompts = generateStoryImagePrompts(results.stories.stories, weekNumber);
  console.log(`   ✓ ${results.story_image_prompts.length} Story image prompts`);

  // 5c. Image prompts — Pinterest
  results.pinterest_image_prompts = generatePinterestImagePrompts(results.pinterest.pins, weekNumber);
  console.log(`   ✓ ${results.pinterest_image_prompts.length} Pinterest image prompts`);

  // Save
  const outputDir = path.join(__dirname, "../output");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, `bloom_focus_week_${weekNumber}.json`);
  results.meta.total_pieces =
    results.video_scripts.length +
    results.tiktok_captions.length +
    results.ig_captions.length +
    results.carousels.length +
    (results.stories?.stories?.length ?? 0) +
    (results.pinterest?.pins?.length ?? 0) +
    (results.image_prompts?.image_prompts?.length ?? 0);

  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));

  console.log("\n" + "━".repeat(50));
  console.log(`✅ Week ${weekNumber} complete!`);
  console.log(`   📄 output/bloom_focus_week_${weekNumber}.json`);
  console.log(`   📊 Total pieces: ${results.meta.total_pieces}`);
  console.log(`\n   • ${results.video_scripts.length} video scripts`);
  console.log(`   • ${results.tiktok_captions.length} TikTok captions`);
  console.log(`   • ${results.ig_captions.length} IG captions`);
  console.log(`   • ${results.carousels.length} carousels (7 slides each)`);
  console.log(`   • ${results.stories.stories.length} Stories`);
  console.log(`   • ${results.pinterest.pins.length} Pinterest pins`);
  console.log(`   • ${results.image_prompts.total} image prompts`);
  console.log(`\n   ➜ Next: node bloom/image-generator.js --week=${weekNumber}`);
  console.log("━".repeat(50) + "\n");

  return results;
}

// ─── Run ──────────────────────────────────────────────────────────────────────
generateWeeklyPack(WEEK).catch((err) => {
  console.error("\n❌ text-generator failed:", err.message);
  process.exit(1);
});
