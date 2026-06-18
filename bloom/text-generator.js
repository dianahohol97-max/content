/**
 * bloom focus — text-generator.js
 * Full weekly content pack generator.
 *
 * Output per week:
 *   - 21 video scripts (3/day x 7 days) — TikTok/Reels/Shorts
 *   - 21 TikTok captions + 21 IG captions
 *   - 70 Pinterest prompts (10/day) — 5 streams
 *   - 7 Stories (one per day)
 *   - 3 Carousels
 *   - All image prompts (9:16 video, 2:3 pinterest, 1:1 stories)
 *
 * Usage:
 *   node bloom/text-generator.js --week=26
 */

import 'dotenv/config';
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const _raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../projects.json"), "utf-8"));
const config = _raw.bloom_focus ?? _raw.projects?.bloom_focus;
if (!config) { console.error("❌ bloom_focus not found in projects.json"); process.exit(1); }

const catalog = config.product_catalog;
const posters = config.posters;
const motivational = config.motivational_posters;
const stickers = config.sticker_packs;
const app = config.app;
const traffic = config.traffic_strategy;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith("--"))
    .map(a => { const [k,v] = a.slice(2).split("="); return [k, v ?? true]; })
);
const WEEK = args.week ? parseInt(args.week) : getCurrentWeekNumber();

function getCurrentWeekNumber() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
}

// ─── All products flat list ───────────────────────────────────────────────────
const ALL_PRODUCTS = Object.values(catalog.categories).flatMap(c => c.products);
const LANGUAGES = ["en", "es", "fr", "de"];
const LANG_LABELS = { en: "English", es: "Español", fr: "Français", de: "Deutsch" };

// ─── Pillars ──────────────────────────────────────────────────────────────────
const PILLARS = Object.values(config.content_pillars).map((p, i) => ({
  id: i + 1, name: p.label, type: p.type, goal: p.goal
}));

// ─── Pinterest v2 strategy: 4 quiz / 3 app / 2 etsy / 1 blog ──────────────────
const PIN_STREAMS = [
  { type: "quiz_funnel", destination: config.quiz_url,                    cta: "Take the free ADHD quiz", count: 4, level: "cold" },
  { type: "free_app",    destination: app?.url ?? "https://bloomfocus.org/app", cta: "Try the free app", count: 3, level: "warm" },
  { type: "etsy_product",destination: catalog.etsy_shop,                  cta: "Get it on Etsy",          count: 2, level: "hot"  },
  { type: "blog_edu",    destination: "https://bloomfocus.org/blog",      cta: "Read more",               count: 1, level: "seo"  },
];

// ─── Daily themes (from Pinterest strategy v2) ────────────────────────────────
const PIN_DAILY_THEMES = [
  "ADHD morning routines",                    // Mon
  "Focus and task initiation",                // Tue
  "Emotions and overwhelm",                   // Wed
  "Organization and planners",                // Thu
  "Dopamine and motivation",                  // Fri
  "The science of the ADHD brain",            // Sat
  "Self-compassion and ADHD identity",        // Sun
];

// ─── Safe JSON parser ─────────────────────────────────────────────────────────
function parseJSON(text) {
  let cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1) cleaned = cleaned.slice(start, end + 1);
  cleaned = cleaned
    .replace(/[\u2018\u2019]/g, "\\'")
    .replace(/[\u201C\u201D]/g, '\\"')
    .replace(/[\u2013\u2014]/g, '-');
  try { return JSON.parse(cleaned); }
  catch { return JSON.parse(cleaned.replace(/[\x00-\x1F\x7F]/g, ' ')); }
}

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM = `You are the content writer for bloom focus, an ADHD digital products brand.
VOICE: "${config.tone?.secondary ?? 'warm, direct, science-backed, like a friend with a neuroscience degree'}"
NEVER SAY: ${(config.tone?.never ?? []).join(", ")}
PRODUCTS: ${ALL_PRODUCTS.map(p => p.name).join(", ")}
QUIZ: ${config.quiz_url}
APP: ${app?.url ?? "bloomfocus.org/app"}
RULE: Name the real ADHD experience BEFORE offering the solution. Validate before educating.
OUTPUT: Return ONLY valid JSON. No markdown. No backticks. No apostrophes in values.`;

// ─── Generate one video script ────────────────────────────────────────────────
async function generateVideoScript(pillar, product, weekNumber, dayIndex, slotIndex) {
  const isQuizVideo = (dayIndex * 3 + slotIndex) % 3 === 0;
  const lang = "en"; // video always English

  const prompt = `Generate a 45-second TikTok/Reels video script for bloom focus. FACELESS brand — no person on camera, text overlay or voiceover only.

PILLAR: ${pillar.name} (${pillar.type})
PRODUCT MENTION: ${product.name} (subtle, only if natural)
DAY: ${dayIndex + 1}, SLOT: ${slotIndex + 1}
${isQuizVideo ? `END WITH: Take the free quiz → ${config.quiz_url}` : `END WITH: ${pillar.goal}`}

Return JSON (no apostrophes in values):
{
  "pillar_id": ${pillar.id},
  "pillar_name": "${pillar.name}",
  "product": "${product.name}",
  "day": ${dayIndex + 1},
  "slot": ${slotIndex + 1},
  "hook": "scroll-stopping first line (0-3s)",
  "bridge": "why this happens neurologically (3-8s)",
  "body": ["point 1", "point 2", "point 3"],
  "cta": "closing call to action",
  "on_screen_text": "bold overlay text max 8 words",
  "is_quiz_video": ${isQuizVideo},
  "format": "text_overlay"
}`;

  const r = await client.messages.create({
    model: "claude-sonnet-4-6", max_tokens: 800, system: SYSTEM,
    messages: [{ role: "user", content: prompt }]
  });
  return parseJSON(r.content[0].text);
}

// ─── Generate captions for one video ─────────────────────────────────────────
async function generateCaptions(script) {
  const hashtags = "#ADHD #ADHDbrain #neurodivergent #ADHDtips #adhdlife #adhdawareness #adhdproductivity #neurodivergentlife #adhdcommunity #bloomfocus";
  const prompt = `Generate TikTok and IG captions for this bloom focus video hook: "${script.hook}" CTA: "${script.cta}"

Return JSON (no apostrophes):
{
  "tiktok_caption": "hook\\n\\n1-2 sentence expansion\\n\\n${script.cta}\\n\\n${hashtags}",
  "ig_caption": "hook\\n\\n1-2 sentence expansion\\n\\n${script.cta}"
}`;

  const r = await client.messages.create({
    model: "claude-sonnet-4-6", max_tokens: 500, system: SYSTEM,
    messages: [{ role: "user", content: prompt }]
  });
  return parseJSON(r.content[0].text);
}

// ─── Generate Pinterest pins for one day (v2 strategy) ───────────────────────
// Distribution: 4 quiz / 3 app / 2 etsy / 1 blog = 10 pins
// Built as 2-3 ideas x 3-5 design variants for the same daily theme.
async function generatePinBatch(dayIndex, weekNumber, product, batchNum) {
  const theme = PIN_DAILY_THEMES[dayIndex % 7];

  // Split 10 pins into two batches of 5 to keep JSON small and reliable
  const streams = batchNum === 1
    ? [
        { num: 1, stream: "quiz_funnel", link: config.quiz_url, cta: "Take the free ADHD quiz", product: "ADHD Quiz", level: "cold" },
        { num: 2, stream: "quiz_funnel", link: config.quiz_url, cta: "Take the free ADHD quiz", product: "ADHD Quiz", level: "cold" },
        { num: 3, stream: "quiz_funnel", link: config.quiz_url, cta: "Take the free ADHD quiz", product: "ADHD Quiz", level: "cold" },
        { num: 4, stream: "quiz_funnel", link: config.quiz_url, cta: "Take the free ADHD quiz", product: "ADHD Quiz", level: "cold" },
        { num: 5, stream: "free_app",    link: app?.url ?? "https://bloomfocus.org/app", cta: "Try the free app", product: "ADHD App", level: "warm" },
      ]
    : [
        { num: 6,  stream: "free_app",     link: app?.url ?? "https://bloomfocus.org/app", cta: "Try the free app", product: "ADHD App", level: "warm" },
        { num: 7,  stream: "free_app",     link: app?.url ?? "https://bloomfocus.org/app", cta: "Try the free app", product: "ADHD App", level: "warm" },
        { num: 8,  stream: "etsy_product", link: catalog.etsy_shop, cta: "Get it on Etsy", product: product.name, level: "hot" },
        { num: 9,  stream: "etsy_product", link: catalog.etsy_shop, cta: "Get it on Etsy", product: product.name, level: "hot" },
        { num: 10, stream: "blog_edu",     link: "https://bloomfocus.org/blog", cta: "Read more", product: "Blog", level: "seo" },
      ];

  const levelGuide = {
    cold: "COLD audience (does not know they have ADHD yet). Hook with recognition: signs, symptoms, am-I-ADHD questions. Lead to the free quiz.",
    warm: "WARM audience (suspects or knows ADHD, wants free help). Hook with the free gamified ADHD web app — no download, no credit card.",
    hot:  `HOT audience (ready to buy). Feature the product "${product.name}" as the solution.`,
    seo:  "SEO authority. Educational ADHD brain science. Long-tail keyword title.",
  };

  const template = streams.map(s =>
    '{"pin_number":' + s.num + ',"stream":"' + s.stream + '","title":"specific long-tail keyword title","description":"2-3 keyword-rich sentences, max 500 chars","link":"' + s.link + '","cta":"' + s.cta + '","product":"' + s.product + '","lang":"en","level":"' + s.level + '","keywords":["long tail kw1","kw2","kw3","kw4"]}'
  ).join(",\n    ");

  const streamGuide = streams.map(s => `Pin ${s.num} (${s.level}): ${levelGuide[s.level]}`).join("\n");

  const prompt = `Generate ${streams.length} Pinterest pins for bloom focus. English only.
TODAY THEME: "${theme}". All pins relate to this theme from different angles.

${streamGuide}

CRITICAL TITLE RULE — be SPECIFIC, not generic:
- BAD: "ADHD tips", "Focus app", "ADHD planner"
- GOOD: "ADHD morning routine when you cannot get out of bed", "Free ADHD app that gamifies focus with no install", "Why your ADHD brain cannot start tasks and the 2 minute fix"
Each title must be a long-tail keyword phrase someone would actually search.

No apostrophes in any values. Evergreen only (no dates). Return JSON array only:
[
    ${template}
]`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const strictNote = attempt > 0
      ? "\n\nCRITICAL: Previous response had invalid JSON. Output ONLY a valid JSON array. Straight double quotes only. NO apostrophes anywhere."
      : "";

    const r = await client.messages.create({
      model: "claude-sonnet-4-6", max_tokens: 1800, system: SYSTEM,
      messages: [{ role: "user", content: prompt + strictNote }]
    });

    let text = r.content[0].text.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim();
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start !== -1 && end !== -1) text = text.slice(start, end+1);
    text = text
      .replace(/[‘’]/g,"")
      .replace(/[“”]/g,'"')
      .replace(/[–—]/g,"-")
      .replace(/[\x00-\x1F\x7F]/g," ");
    try {
      return JSON.parse(text);
    } catch(e) {
      if (attempt === 2) {
        console.log(`\n   ⚠ Pin batch ${batchNum} fell back to safe pins`);
        return streams.map(s => ({
          pin_number: s.num, stream: s.stream,
          title: theme, description: "Tools designed for how ADHD brains actually work.",
          link: s.link, cta: s.cta, product: s.product, lang: "en", level: s.level,
          keywords: ["ADHD", "neurodivergent", "ADHD tools"]
        }));
      }
    }
  }
}

async function generateDailyPins(dayIndex, weekNumber, usedProducts) {
  const product = ALL_PRODUCTS[usedProducts % ALL_PRODUCTS.length];

  const [batch1, batch2] = await Promise.all([
    generatePinBatch(dayIndex, weekNumber, product, 1),
    generatePinBatch(dayIndex, weekNumber, product, 2),
  ]);

  return {
    day: dayIndex + 1,
    theme: PIN_DAILY_THEMES[dayIndex % 7],
    pins: [...batch1, ...batch2]
  };
}

// ─── Generate Stories ─────────────────────────────────────────────────────────
async function generateStories(weekNumber) {
  const prompt = `Generate 7 Instagram Stories for bloom focus. FACELESS brand. Week ${weekNumber}.

Mon=Poll, Tue=Tip, Wed=BTS, Thu=Quiz(→${config.quiz_url}), Fri=Product, Sat=QandA, Sun=Reflection

Return JSON (no apostrophes in values):
{
  "week": ${weekNumber},
  "stories": [
    {"day":"monday","type":"Poll","headline":"max 10 words","poll_option_1":"...","poll_option_2":"...","note":"IG poll sticker"},
    {"day":"tuesday","type":"Tip","headline":"max 8 words","body":"1-2 sentences","note":"text on pastel bg"},
    {"day":"wednesday","type":"BTS","headline":"max 10 words","body":"1-2 sentences","note":"text card"},
    {"day":"thursday","type":"Quiz","headline":"max 10 words","body":"1 sentence","cta":"${config.quiz_url}","note":"link sticker"},
    {"day":"friday","type":"Product","product":"product name","headline":"max 10 words","body":"1-2 sentences","note":"image and text"},
    {"day":"saturday","type":"QA","question":"open question max 12 words","note":"QandA sticker"},
    {"day":"sunday","type":"Reflection","headline":"max 10 words","body":"1 soft sentence","note":"calm energy"}
  ]
}`;

  const r = await client.messages.create({
    model: "claude-sonnet-4-6", max_tokens: 1000, system: SYSTEM,
    messages: [{ role: "user", content: prompt }]
  });
  return parseJSON(r.content[0].text);
}

// ─── Generate Carousels ───────────────────────────────────────────────────────
async function generateCarousel(type, weekNumber, productIndex, pillar) {
  const product = ALL_PRODUCTS[productIndex % ALL_PRODUCTS.length];

  // Viral 2026 carousel rules baked into every prompt
  const VIRAL_RULES = `VIRAL CAROUSEL RULES (Instagram 2026):
- 9 slides total.
- Slide 1 (cover): answers "is this for me?" and "what will I get?" in under 10 words. Scroll-stopping.
- Slide 3: the strongest value (the "value bomb") — most surprising or useful insight goes HERE, not slide 1.
- EVERY slide must work as a hook on its own (Instagram shows different starting slides to different people).
- One idea per slide. Body max 2 short sentences.
- Last slide: clear CTA.
- No apostrophes in any JSON values.`;

  let prompt;

  if (type === "product") {
    prompt = `Generate a 9-slide Instagram PRODUCT carousel for bloom focus. FACELESS brand. Product: "${product.name}".
${VIRAL_RULES}
Flow: 1)Problem hook cover, 2)Name the real ADHD struggle, 3)The surprising insight about why it happens (value bomb), 4)Why normal solutions fail ADHD, 5)Introduce ${product.name}, 6-7)How it works specifically, 8)Before vs after, 9)CTA link in bio.
Return JSON: {"carousel_type":"product","product":"${product.name}","cover_hook":"the slide 1 text","slides":[${Array.from({length:9},(_, i)=>`{"slide":${i+1},"title":"...","body":"..."}`).join(",")}]}`;
  } else if (type === "thisorthat") {
    prompt = `Generate a 9-slide Instagram "THIS OR THAT" carousel for bloom focus. FACELESS brand. Topic: ADHD experiences related to ${pillar?.name ?? "daily life"}.
${VIRAL_RULES}
This format drives DM shares: each middle slide presents two relatable ADHD options and asks which one you are.
Flow: 1)Cover "Which ADHD ___ are you?", 2-8)Each slide describes 2 contrasting ADHD types/situations and asks to pick, 9)CTA comment your pick + take the quiz ${config.quiz_url}.
Return JSON: {"carousel_type":"thisorthat","topic":"the theme","cover_hook":"the slide 1 text","slides":[${Array.from({length:9},(_, i)=>`{"slide":${i+1},"title":"...","body":"..."}`).join(",")}]}`;
  } else if (type === "listicle") {
    prompt = `Generate a 9-slide Instagram LISTICLE carousel for bloom focus. FACELESS brand. Pillar: ${pillar?.name ?? "What Actually Helps"}.
${VIRAL_RULES}
Flow: 1)Cover with a number hook like "7 ADHD ___ that actually work", 2-8)One tip/item per slide (specific, ADHD-science based), 9)Save this + CTA.
Return JSON: {"carousel_type":"listicle","topic":"the theme","cover_hook":"the slide 1 text","slides":[${Array.from({length:9},(_, i)=>`{"slide":${i+1},"title":"...","body":"..."}`).join(",")}]}`;
  } else {
    // educational
    prompt = `Generate a 9-slide Instagram EDUCATIONAL carousel for bloom focus. FACELESS brand. Pillar: ${pillar?.name ?? "This Is Your Brain"}.
${VIRAL_RULES}
Flow: 1)Bold hook cover, 2)Name the experience, 3)The surprising brain-science insight (value bomb), 4-7)One concept each, 8)What this means for you, 9)Save this + CTA.
Return JSON: {"carousel_type":"educational","topic":"the main topic","cover_hook":"the slide 1 text","slides":[${Array.from({length:9},(_, i)=>`{"slide":${i+1},"title":"...","body":"..."}`).join(",")}]}`;
  }

  const r = await client.messages.create({
    model: "claude-sonnet-4-6", max_tokens: 2000, system: SYSTEM,
    messages: [{ role: "user", content: prompt }]
  });
  return parseJSON(r.content[0].text);
}

// ─── Image prompts ────────────────────────────────────────────────────────────
const BASE_IMG = `Realistic aesthetic photograph, cozy and warm. Soft natural lighting, muted pastel tones (lavender, cream, sage, blush, soft blue). Shallow depth of field, film-like quality. Minimalist composition. No people, no faces, no hands holding objects. No text, no letters, no words anywhere in the image. Calm, inviting, aspirational lifestyle aesthetic that an adult would save to a mood board.`;

function videoImagePrompts(script) {
  // Generate 8 frame prompts — photo-realistic, one per script segment
  const additions = {
    1: "a calm desk scene suggesting focus — open notebook, soft light, a single plant, blurred warm background",
    2: "a comforting cozy moment — a warm cup of coffee or tea on a wooden desk, soft blanket texture, gentle morning light",
    3: "a tidy organized workspace — a planner open on a clean desk, pen resting beside it, minimal and achievable",
    4: "a thoughtful flat-lay — a checklist or journal, a few simple objects arranged neatly, inviting curiosity",
    5: `an aesthetic flat-lay featuring a printed planner or workbook related to "${script.product}" on a styled desk`
  };
  const theme = additions[script.pillar_id] ?? additions[1];

  const segments = [
    { seg: "hook", text: script.hook },
    { seg: "bridge", text: script.bridge },
    ...(script.body ?? []).map((b, i) => ({ seg: `body_${i+1}`, text: b })),
    { seg: "cta", text: script.cta },
  ];

  const atmospheric = [
    "a wide cozy desk scene with soft natural window light, warm and calm",
    "an extreme close-up of a comforting detail — coffee cup rim, plant leaf, paper texture",
    "a softly blurred aesthetic background, warm bokeh, calming mood",
  ];
  while (segments.length < 8) {
    segments.push({ seg: `extra_${segments.length}`, text: atmospheric[segments.length % atmospheric.length] });
  }

  const finalSegments = segments.slice(0, 10);

  return finalSegments.map((s, i) => ({
    frame: i + 1,
    segment: s.seg,
    prompt: `${BASE_IMG} Scene direction: ${theme}. This frame should feel cohesive with the others in the set — same lighting, same color mood. Vertical 9:16 portrait orientation, tall format. Atmosphere for this moment: "${s.text}"`,
  }));
}

function pinterestImagePrompt(pin) {
  const streamAdditions = {
    etsy_product: `An aesthetic flat-lay photograph of a printed planner or workbook related to "${pin.product}" on a styled desk with soft props (coffee, plant, pen).`,
    site_product: `A clean styled workspace photograph with a printed planner or worksheet related to "${pin.product}", soft natural light.`,
    free_app: "A realistic photograph of a phone or tablet resting on a cozy desk showing a calm app interface, warm lifestyle setting.",
    quiz_funnel: "An inviting flat-lay photograph — a notebook with a pen, suggesting a quiz or self-reflection, warm and curious mood.",
    blog_edu: "A calm aesthetic photograph representing focus and clarity — tidy desk, soft light, plant, journal."
  };
  return `${BASE_IMG} ${streamAdditions[pin.stream] ?? streamAdditions.blog_edu} Vertical 2:3 portrait orientation, tall Pinterest format.`;
}

function storyImagePrompt(story) {
  const typeAdditions = {
    Poll: "A flat-lay photograph suggesting a choice — two objects or two paths, warm and light.",
    Tip: "A single calm photograph suggesting focus — tidy desk corner, soft light, one focal object.",
    BTS: "A cozy behind-the-scenes photograph — desk with notebook and coffee, warm natural light.",
    Quiz: "An inviting photograph — a journal or checklist on a desk, curious and warm mood.",
    Product: "An aesthetic flat-lay photograph of a printed planner or workbook on a styled desk.",
    QA: "A warm open photograph — a cup of coffee and notebook, inviting conversation.",
    Reflection: "A peaceful evening photograph — soft lamp light, plant, a cup of tea, calm and restful."
  };
  return `${BASE_IMG} ${typeAdditions[story.type] ?? ""} Square 1:1 format for Instagram Stories.`;
}

// ─── Main runner ──────────────────────────────────────────────────────────────
async function generateWeeklyPack(weekNumber) {
  console.log(`\n🌸 bloom focus — Week ${weekNumber}\n${"━".repeat(50)}`);

  const results = {
    meta: { brand: "bloom_focus", week: weekNumber, generated_at: new Date().toISOString() },
    video_scripts: [], tiktok_captions: [], ig_captions: [],
    pinterest_days: [], stories: null, carousels: [],
    image_prompts: { videos: [], pinterest: [], stories: [], carousels: [] }
  };

  // ── 1. Video scripts — 3/day × 7 days = 21 ──────────────────────────────
  console.log("📝 Generating 21 video scripts (3/day × 7 days)...");
  let productIdx = 0;
  for (let day = 0; day < 7; day++) {
    for (let slot = 0; slot < 3; slot++) {
      const pillar = PILLARS[(day * 3 + slot) % PILLARS.length];
      const product = ALL_PRODUCTS[productIdx % ALL_PRODUCTS.length];
      process.stdout.write(`   Day ${day+1} Slot ${slot+1} [${pillar.name}]... `);

      const script = await generateVideoScript(pillar, product, weekNumber, day, slot);
      const captions = await generateCaptions(script);

      results.video_scripts.push(script);
      results.tiktok_captions.push({ day: day+1, slot: slot+1, ...captions });
      results.ig_captions.push({ day: day+1, slot: slot+1, ig_caption: captions.ig_caption });
      results.image_prompts.videos.push({ id: `video_d${day+1}_s${slot+1}`, day: day+1, slot: slot+1, pillar_name: script.pillar_name, hook: script.hook, frames: videoImagePrompts(script) });

      productIdx++;
      console.log("✓");
    }
  }

  // ── 2. Pinterest — 10 pins/day × 7 days = 70 ────────────────────────────
  console.log("\n📌 Generating 70 Pinterest pins (10/day × 7 days)...");
  for (let day = 0; day < 7; day++) {
    process.stdout.write(`   Day ${day+1} (10 pins)... `);
    const dayPins = await generateDailyPins(day, weekNumber, day);
    results.pinterest_days.push(dayPins);

    // Image prompts for each pin
    for (const pin of dayPins.pins) {
      results.image_prompts.pinterest.push({
        id: `pin_d${day+1}_${pin.pin_number}`,
        day: day+1,
        pin_number: pin.pin_number,
        stream: pin.stream,
        lang: pin.lang,
        prompt: pinterestImagePrompt(pin)
      });
    }
    console.log("✓");
  }

  // ── 3. Stories — 7 days ──────────────────────────────────────────────────
  console.log("\n📱 Generating Stories...");
  results.stories = await generateStories(weekNumber);
  for (const story of results.stories.stories) {
    results.image_prompts.stories.push({
      id: `story_${story.day}`,
      day: story.day,
      type: story.type,
      prompt: storyImagePrompt(story)
    });
  }
  console.log("   ✓ 7 stories + image prompts");

  // ── 4. Carousels — 7 total (one per day), rotating viral formats ─────────
  console.log("\n🎠 Generating 7 carousels (1/day, viral formats)...");

  // Weekly carousel plan: mix of formats proven to drive saves + DM shares
  // educational (saves), listicle (saves), thisorthat (DM shares), product (conversion)
  const carouselPlan = [
    { day: 1, type: "educational", pillar: PILLARS[0] },           // This Is Your Brain
    { day: 2, type: "listicle",    pillar: PILLARS[2] },           // What Actually Helps
    { day: 3, type: "thisorthat",  pillar: PILLARS[1] },           // You Are Not Alone (DM shares)
    { day: 4, type: "product",     pillar: PILLARS[4], prod: 1 },  // Behind the Product
    { day: 5, type: "educational", pillar: PILLARS[3] },           // Know Your Brain
    { day: 6, type: "listicle",    pillar: PILLARS[2] },           // What Actually Helps
    { day: 7, type: "product",     pillar: PILLARS[4], prod: 7 },  // Behind the Product
  ];

  let carIdx = 0;
  for (const plan of carouselPlan) {
    process.stdout.write(`   Day ${plan.day} [${plan.type}]... `);
    const car = await generateCarousel(plan.type, weekNumber, plan.prod ?? carIdx, plan.pillar);
    car.day = plan.day;
    results.carousels.push(car);

    // Photo cover prompt based on type
    const coverScene = plan.type === "product"
      ? `An aesthetic flat-lay photograph of a printed planner related to "${car.product ?? ""}" on a styled desk.`
      : `A calm aesthetic photograph representing: "${car.topic ?? car.cover_hook ?? ""}". Tidy desk, soft light.`;
    results.image_prompts.carousels.push({
      id: `carousel_d${plan.day}_${plan.type}`,
      day: plan.day,
      type: plan.type,
      prompt: `${BASE_IMG} ${coverScene} Vertical 4:5 format.`
    });
    carIdx++;
    console.log("✓");
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  const outputDir = path.join(__dirname, "../output");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const totalPins = results.pinterest_days.reduce((s, d) => s + d.pins.length, 0);
  const videoFrameCount = results.image_prompts.videos.reduce((s, v) => s + v.frames.length, 0);
  const totalImgPrompts = videoFrameCount + results.image_prompts.pinterest.length + results.image_prompts.stories.length + results.image_prompts.carousels.length;

  results.meta.summary = {
    video_scripts: results.video_scripts.length,
    pinterest_pins: totalPins,
    stories: results.stories.stories.length,
    carousels: results.carousels.length,
    image_prompts: totalImgPrompts,
    total_pieces: results.video_scripts.length + totalPins + results.stories.stories.length + results.carousels.length
  };

  fs.writeFileSync(
    path.join(outputDir, `bloom_focus_week_${weekNumber}.json`),
    JSON.stringify(results, null, 2)
  );

  console.log(`\n${"━".repeat(50)}`);
  console.log(`✅ Week ${weekNumber} complete!`);
  console.log(`   📹 Video scripts: ${results.video_scripts.length} (3/day)`);
  console.log(`   📌 Pinterest pins: ${totalPins} (10/day)`);
  console.log(`   📱 Stories: ${results.stories.stories.length}`);
  console.log(`   🎠 Carousels: ${results.carousels.length}`);
  console.log(`   🎨 Image prompts: ${totalImgPrompts}`);
  console.log(`   📦 Total pieces: ${results.meta.summary.total_pieces}`);
  console.log(`\n   ➜ Next: node bloom/sheets-publisher.js --week=${weekNumber}`);
  console.log(`${"━".repeat(50)}\n`);

  return results;
}

generateWeeklyPack(WEEK).catch(err => {
  console.error("\n❌ text-generator failed:", err.message);
  process.exit(1);
});
