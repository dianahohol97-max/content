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
 *   - 1 DALL-E image prompt per post (15 total)
 *
 * Usage:
 *   node bloom/text-generator.js --week=26
 *   node bloom/text-generator.js --week=26 --pillar=2   (generate one pillar only)
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../projects.json"), "utf-8")
).bloom_focus;

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

// ─── System prompt (shared across all generations) ───────────────────────────
const SYSTEM_PROMPT = `You are the content writer for bloom focus, an ADHD digital products brand.

BRAND VOICE: "${config.brand.tone}"

NEVER SAY: ${config.brand.never_say.join(", ")}

PRODUCTS: ${config.products.join(", ")}

RULES:
- Always name the real ADHD experience BEFORE offering the solution
- Reference neuroscience simply ("your brain needs a dopamine hit to start — here's how to manufacture one")
- Validate before educating
- Make people feel seen, not broken
- Humor welcome — never at ADHD's expense
- Never use the word "hack"
- Never say "ADHD is a superpower" without nuance
- Content is English only

OUTPUT: Return ONLY valid JSON. No markdown, no backticks, no preamble.`;

// ─── Generate one video script ───────────────────────────────────────────────
async function generateVideoScript(pillar, weekNumber, videoIndex) {
  const isQuizVideo = videoIndex % 3 === 0; // every 3rd video gets quiz CTA

  const prompt = `Generate a TikTok/Instagram Reel video script for bloom focus.

PILLAR: ${pillar.name} (${pillar.type})
GOAL: ${pillar.goal}
WEEK: ${weekNumber}
VIDEO INDEX: ${videoIndex} (${isQuizVideo ? "QUIZ CTA VIDEO" : "standard CTA"})

SCRIPT STRUCTURE (strictly follow timings):
- HOOK (0-3s): Specific ADHD experience or brain fact. Must stop scroll immediately.
- BRIDGE (3-8s): Why this happens — neuroscience, kept simple
- BODY (8-45s): What actually helps OR relatable validation (3-4 concrete points)
- CTA (last 5s): ${isQuizVideo ? "Take the free quiz → bloomfocus.org/quiz" : pillar.cta}

HOOK FORMULAS FOR THIS PILLAR:
${pillar.hooks.join("\n")}

Return this exact JSON structure:
{
  "pillar_id": ${pillar.id},
  "pillar_name": "${pillar.name}",
  "video_index": ${videoIndex},
  "hook": "the hook line (0-3s)",
  "bridge": "the bridge line (3-8s)",
  "body": ["point 1", "point 2", "point 3", "point 4"],
  "cta": "the closing CTA (last 5s)",
  "on_screen_text": "short bold text shown as overlay (max 8 words)",
  "spoken_duration_seconds": 45,
  "is_quiz_video": ${isQuizVideo}
}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  return JSON.parse(response.content[0].text);
}

// ─── Generate captions ────────────────────────────────────────────────────────
async function generateCaptions(script, pillar) {
  const hashtags = config.platforms.tiktok.hashtag_list.join(" ");

  const prompt = `Generate captions for a bloom focus video based on this script hook: "${script.hook}"

PILLAR: ${pillar.name}
GOAL: ${pillar.goal}

Return this exact JSON:
{
  "tiktok_caption": "hook sentence\\n\\n1-2 sentence expansion\\n\\n${script.cta}\\n\\n${hashtags}",
  "ig_caption": "hook sentence\\n\\n1-2 sentence expansion\\n\\n${script.cta}"
}

Rules:
- TikTok caption: include hashtags at the end
- IG caption: NO hashtags
- Both start with the same hook
- Keep both under 150 words (before hashtags)
- IG caption slightly more personal/warm in tone`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  return JSON.parse(response.content[0].text);
}

// ─── Generate carousel ────────────────────────────────────────────────────────
async function generateCarousel(pillar, weekNumber, carouselType) {
  const isProductCarousel = carouselType === "product";
  const product =
    config.products[Math.floor(Math.random() * config.products.length)];

  const prompt = isProductCarousel
    ? `Generate a 7-slide PRODUCT carousel for bloom focus.
PRODUCT: ${product}
PILLAR: ${pillar.name}

SLIDE STRUCTURE:
1. Problem statement (hook)
2. Why existing solutions fail ADHD brains
3. Introduce the product
4. How it works — specific detail 1
5. How it works — specific detail 2
6. Before / After using it
7. Link in bio CTA

Return exact JSON:
{
  "carousel_type": "product",
  "product": "${product}",
  "slides": [
    { "slide": 1, "title": "...", "body": "..." },
    { "slide": 2, "title": "...", "body": "..." },
    { "slide": 3, "title": "...", "body": "..." },
    { "slide": 4, "title": "...", "body": "..." },
    { "slide": 5, "title": "...", "body": "..." },
    { "slide": 6, "title": "...", "body": "..." },
    { "slide": 7, "title": "...", "body": "..." }
  ]
}`
    : `Generate a 7-slide EDUCATIONAL carousel for bloom focus.
PILLAR: ${pillar.name}
WEEK: ${weekNumber}

SLIDE STRUCTURE:
1. Bold hook + "Save this" prompt
2-6. One concept per slide (numbered). Title + 2-3 lines max.
7. Summary + CTA (comment or quiz link)

Return exact JSON:
{
  "carousel_type": "educational",
  "topic": "the main topic",
  "slides": [
    { "slide": 1, "title": "...", "body": "..." },
    { "slide": 2, "title": "...", "body": "..." },
    { "slide": 3, "title": "...", "body": "..." },
    { "slide": 4, "title": "...", "body": "..." },
    { "slide": 5, "title": "...", "body": "..." },
    { "slide": 6, "title": "...", "body": "..." },
    { "slide": 7, "title": "...", "body": "..." }
  ]
}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  return JSON.parse(response.content[0].text);
}

// ─── Generate Stories (7 days) ────────────────────────────────────────────────
async function generateStories(weekNumber) {
  const schedule = config.platforms.ig_stories.schedule;

  const prompt = `Generate 7 Instagram Stories for bloom focus, one per day of the week.

WEEK: ${weekNumber}

DAILY SCHEDULE:
${Object.entries(schedule)
  .map(([day, type]) => `${day}: ${type}`)
  .join("\n")}

Each story is SHORT — this is a Story card, not a caption.
Thursday MUST end with: bloomfocus.org/quiz

Return exact JSON:
{
  "week": ${weekNumber},
  "stories": [
    {
      "day": "monday",
      "type": "Poll",
      "headline": "main text (max 10 words)",
      "poll_option_1": "...",
      "poll_option_2": "...",
      "note": "use IG poll sticker"
    },
    {
      "day": "tuesday",
      "type": "Tip",
      "headline": "tip title (max 8 words)",
      "body": "1-2 sentences max",
      "note": "text on pastel bg"
    },
    {
      "day": "wednesday",
      "type": "BTS",
      "headline": "behind the scenes text (max 10 words)",
      "body": "1-2 sentences",
      "note": "text card"
    },
    {
      "day": "thursday",
      "type": "Quiz",
      "headline": "quiz hook (max 10 words)",
      "body": "1 sentence teaser",
      "cta": "bloomfocus.org/quiz",
      "note": "swipe up or link sticker"
    },
    {
      "day": "friday",
      "type": "Product",
      "product": "product name",
      "headline": "product hook (max 10 words)",
      "body": "1-2 sentences why it works for ADHD",
      "note": "image + text"
    },
    {
      "day": "saturday",
      "type": "QA",
      "question": "open question for the audience (max 12 words)",
      "note": "use Q&A sticker"
    },
    {
      "day": "sunday",
      "type": "Reflection",
      "headline": "gentle closing thought (max 10 words)",
      "body": "1 soft sentence",
      "note": "soft tip, calm energy"
    }
  ]
}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  return JSON.parse(response.content[0].text);
}

// ─── Generate Pinterest descriptions ─────────────────────────────────────────
async function generatePinterestDescriptions(scripts, weekNumber) {
  const prompt = `Generate 5 Pinterest pin descriptions for bloom focus.
WEEK: ${weekNumber}

Based on these video hooks:
${scripts.map((s, i) => `${i + 1}. "${s.hook}" (Pillar: ${s.pillar_name})`).join("\n")}

Pinterest rules:
- Keyword-rich title and description
- SEO-focused: people search "ADHD tips", "ADHD planner", "ADHD morning routine" etc.
- Link is either bloomfocus.org or Etsy listing
- 2-3 sentence descriptions
- Evergreen content (no "this week" references)

Return exact JSON:
{
  "week": ${weekNumber},
  "pins": [
    {
      "pin_number": 1,
      "title": "keyword-rich pin title",
      "description": "2-3 sentence SEO description with natural keywords",
      "link": "bloomfocus.org or etsy.com/shop/bloomfocus",
      "keywords": ["keyword1", "keyword2", "keyword3"]
    },
    { "pin_number": 2, "title": "...", "description": "...", "link": "...", "keywords": [] },
    { "pin_number": 3, "title": "...", "description": "...", "link": "...", "keywords": [] },
    { "pin_number": 4, "title": "...", "description": "...", "link": "...", "keywords": [] },
    { "pin_number": 5, "title": "...", "description": "...", "link": "...", "keywords": [] }
  ]
}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  return JSON.parse(response.content[0].text);
}

// ─── Generate DALL-E image prompts ────────────────────────────────────────────
async function generateImagePrompts(scripts, carousels, weekNumber) {
  const BASE_PROMPT = `Soft pastel digital illustration in a cozy, approachable style. Color palette: lavender #E8DEFF, cream #FFF8F0, sage green #D4E8D4, blush #FFD4E4, sky blue #D4EEFF. Flat vector illustration with soft watercolor texture. Warm, calm, friendly feeling. No real people, no photos. No text, no words, no letters in the image.`;

  const PILLAR_ADDITIONS = {
    1: "Show abstract brain concept — neurons firing, thought bubbles, or a stylized brain illustration. Prefer metaphorical (lightbulb, gears, clouds, sparks) over literal brain imagery.",
    2: "Cozy scene suggesting comfort — illustrated person wrapped in a blanket, warm cup of tea, or softly lit desk. Feeling of being understood and safe.",
    3: "Organized, calm workspace or planner with simple illustrated elements. Clean, achievable, not overwhelming. One focal point only.",
    4: "Interactive feel — checklist graphic, quiz-style layout, or simple Y/N visual. Engaging and curious, not clinical.",
    5: "Show the specific product as a soft illustration — planner open on a desk, timer on a table, menu pinned to a wall. Context-rich but minimal.",
  };

  const imagePrompts = [];

  // 5 prompts for video posts
  for (const script of scripts) {
    const addition = PILLAR_ADDITIONS[script.pillar_id];
    imagePrompts.push({
      id: `video_p${script.pillar_id}`,
      content_type: "video",
      aspect_ratio: "9:16",
      pillar: script.pillar_name,
      hook: script.hook,
      prompt: `${BASE_PROMPT} ${addition} Vertical 9:16 format. Scene inspired by this ADHD experience: "${script.hook}"`,
    });
  }

  // 2 prompts for carousels
  for (const carousel of carousels) {
    const pillarId = carousel.carousel_type === "product" ? 5 : 1;
    const addition = PILLAR_ADDITIONS[pillarId];
    const topic =
      carousel.carousel_type === "product" ? carousel.product : carousel.topic;
    imagePrompts.push({
      id: `carousel_${carousel.carousel_type}`,
      content_type: "carousel_cover",
      aspect_ratio: "4:5",
      pillar: carousel.carousel_type === "product" ? "Behind the Product" : "This Is Your Brain",
      topic: topic,
      prompt: `${BASE_PROMPT} ${addition} 4:5 format for Instagram carousel. Scene related to: "${topic}"`,
    });
  }

  return {
    week: weekNumber,
    total: imagePrompts.length,
    image_prompts: imagePrompts,
  };
}

// ─── Main runner ──────────────────────────────────────────────────────────────
async function generateWeeklyPack(weekNumber) {
  console.log(`\n🌸 bloom focus — generating Week ${weekNumber} content pack\n`);
  console.log("━".repeat(50));

  const pillars = SINGLE_PILLAR
    ? config.pillars.filter((p) => p.id === SINGLE_PILLAR)
    : config.pillars;

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

  // 1. Generate video scripts (one per pillar)
  console.log("📝 Generating video scripts...");
  for (let i = 0; i < pillars.length; i++) {
    const pillar = pillars[i];
    process.stdout.write(`   Pillar ${pillar.id}: ${pillar.name}... `);
    const script = await generateVideoScript(pillar, weekNumber, i + 1);
    results.video_scripts.push(script);

    // Generate captions alongside each script
    const captions = await generateCaptions(script, pillar);
    results.tiktok_captions.push({ pillar_id: pillar.id, ...captions });
    results.ig_captions.push({
      pillar_id: pillar.id,
      ig_caption: captions.ig_caption,
    });

    console.log("✓");
  }

  // 2. Generate carousels (1 EDU + 1 Product)
  console.log("\n🎠 Generating carousels...");
  process.stdout.write("   Educational carousel... ");
  const eduCarousel = await generateCarousel(pillars[0], weekNumber, "educational");
  results.carousels.push(eduCarousel);
  console.log("✓");

  process.stdout.write("   Product carousel... ");
  const productCarousel = await generateCarousel(pillars[4] ?? pillars[0], weekNumber, "product");
  results.carousels.push(productCarousel);
  console.log("✓");

  // 3. Generate Stories
  console.log("\n📱 Generating Stories (7 days)...");
  results.stories = await generateStories(weekNumber);
  console.log("   ✓ All 7 stories generated");

  // 4. Generate Pinterest descriptions
  console.log("\n📌 Generating Pinterest descriptions...");
  results.pinterest = await generatePinterestDescriptions(
    results.video_scripts,
    weekNumber
  );
  console.log("   ✓ 5 Pinterest pins generated");

  // 5. Generate image prompts for DALL-E
  console.log("\n🎨 Generating DALL-E image prompts...");
  results.image_prompts = await generateImagePrompts(
    results.video_scripts,
    results.carousels,
    weekNumber
  );
  console.log(`   ✓ ${results.image_prompts.total} image prompts generated`);

  // Count total pieces
  results.meta.total_pieces =
    results.video_scripts.length +
    results.tiktok_captions.length +
    results.ig_captions.length +
    results.carousels.length +
    results.stories.stories.length +
    results.pinterest.pins.length +
    results.image_prompts.image_prompts.length;

  // Save to file
  const outputDir = path.join(__dirname, "../output");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, `bloom_focus_week_${weekNumber}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));

  console.log("\n" + "━".repeat(50));
  console.log(`✅ Week ${weekNumber} content pack complete!`);
  console.log(`   📄 Saved to: output/bloom_focus_week_${weekNumber}.json`);
  console.log(`   📊 Total pieces: ${results.meta.total_pieces}`);
  console.log(`\n   Breakdown:`);
  console.log(`   • ${results.video_scripts.length} video scripts`);
  console.log(`   • ${results.tiktok_captions.length} TikTok captions`);
  console.log(`   • ${results.ig_captions.length} IG captions`);
  console.log(`   • ${results.carousels.length} carousels (7 slides each)`);
  console.log(`   • ${results.stories.stories.length} Stories (Mon–Sun)`);
  console.log(`   • ${results.pinterest.pins.length} Pinterest descriptions`);
  console.log(
    `   • ${results.image_prompts.image_prompts.length} DALL-E image prompts`
  );
  console.log(`\n   ➜ Next: run sheets-publisher.js to push to Google Sheets`);
  console.log("━".repeat(50) + "\n");

  return results;
}

// ─── Run ──────────────────────────────────────────────────────────────────────
generateWeeklyPack(WEEK).catch((err) => {
  console.error("\n❌ text-generator failed:", err.message);
  process.exit(1);
});
