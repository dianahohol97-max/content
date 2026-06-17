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

// ─── Pinterest traffic streams ────────────────────────────────────────────────
const PIN_STREAMS = [
  { type: "etsy_product",  destination: catalog.etsy_shop,        cta: "Get it on Etsy",          count: 2 },
  { type: "site_product",  destination: "https://bloomfocus.org/shop", cta: "Shop the toolkit",   count: 2 },
  { type: "free_app",      destination: app?.url ?? "https://bloomfocus.org/app", cta: "Try free", count: 2 },
  { type: "quiz_funnel",   destination: config.quiz_url,          cta: "Take the free ADHD quiz", count: 2 },
  { type: "blog_edu",      destination: "https://bloomfocus.org/blog", cta: "Read more",          count: 2 },
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

// ─── Generate 10 Pinterest pins for one day ───────────────────────────────────
async function generateDailyPins(dayIndex, weekNumber, usedProducts) {
  const product = ALL_PRODUCTS[usedProducts % ALL_PRODUCTS.length];
  const poster = posters?.series[usedProducts % posters.series.length];
  const lang = LANGUAGES[dayIndex % LANGUAGES.length];

  const prompt = `Generate exactly 10 Pinterest pins for bloom focus. Day ${dayIndex + 1} of Week ${weekNumber}.

PIN BREAKDOWN (2 pins each stream):
1-2: ETSY PRODUCT pins → ${catalog.etsy_shop} — feature product: "${product.name}"
3-4: SITE SHOP pins → https://bloomfocus.org/shop — feature product: "${product.name}"
5-6: FREE APP pins → ${app?.url} — feature the free ADHD toolkit app (6 tools, gamification)
7-8: QUIZ FUNNEL pins → ${config.quiz_url} — lead to free ADHD quiz
9-10: BLOG/EDU pins → https://bloomfocus.org/blog — educational ADHD content

RULES:
- Vertical 2:3 format
- Keyword-rich SEO titles and descriptions
- Evergreen content only (no dates or week references)
- No apostrophes in any JSON values
- Mix languages: some pins in ${LANG_LABELS[lang]}

Return JSON:
{
  "day": ${dayIndex + 1},
  "pins": [
    {"pin_number":1,"stream":"etsy_product","title":"...","description":"...","link":"${catalog.etsy_shop}","cta":"Get it on Etsy","product":"${product.name}","lang":"en","keywords":["kw1","kw2"]},
    {"pin_number":2,"stream":"etsy_product","title":"...","description":"...","link":"${catalog.etsy_shop}","cta":"Get it on Etsy","product":"${product.name}","lang":"${lang}","keywords":["kw1","kw2"]},
    {"pin_number":3,"stream":"site_product","title":"...","description":"...","link":"https://bloomfocus.org/shop","cta":"Shop the toolkit","product":"${product.name}","lang":"en","keywords":["kw1","kw2"]},
    {"pin_number":4,"stream":"site_product","title":"...","description":"...","link":"https://bloomfocus.org/shop","cta":"Shop the toolkit","product":"${product.name}","lang":"${lang}","keywords":["kw1","kw2"]},
    {"pin_number":5,"stream":"free_app","title":"...","description":"...","link":"${app?.url}","cta":"Try free","product":"ADHD App","lang":"en","keywords":["kw1","kw2"]},
    {"pin_number":6,"stream":"free_app","title":"...","description":"...","link":"${app?.url}","cta":"Try free","product":"ADHD App","lang":"${lang}","keywords":["kw1","kw2"]},
    {"pin_number":7,"stream":"quiz_funnel","title":"...","description":"...","link":"${config.quiz_url}","cta":"Take the free ADHD quiz","product":"ADHD Quiz","lang":"en","keywords":["kw1","kw2"]},
    {"pin_number":8,"stream":"quiz_funnel","title":"...","description":"...","link":"${config.quiz_url}","cta":"Take the free ADHD quiz","product":"ADHD Quiz","lang":"${lang}","keywords":["kw1","kw2"]},
    {"pin_number":9,"stream":"blog_edu","title":"...","description":"...","link":"https://bloomfocus.org/blog","cta":"Read more","product":"Blog","lang":"en","keywords":["kw1","kw2"]},
    {"pin_number":10,"stream":"blog_edu","title":"...","description":"...","link":"https://bloomfocus.org/blog","cta":"Read more","product":"Blog","lang":"${lang}","keywords":["kw1","kw2"]}
  ]
}`;

  const r = await client.messages.create({
    model: "claude-sonnet-4-6", max_tokens: 2000, system: SYSTEM,
    messages: [{ role: "user", content: prompt }]
  });
  return parseJSON(r.content[0].text);
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
async function generateCarousel(type, weekNumber, productIndex) {
  const product = ALL_PRODUCTS[productIndex % ALL_PRODUCTS.length];

  const prompt = type === "product"
    ? `Generate a 7-slide Instagram carousel for bloom focus product: "${product.name}". FACELESS brand.
Slides: 1)Problem hook, 2)Why existing solutions fail ADHD, 3)Introduce product, 4-5)How it works, 6)Before/After, 7)Link in bio CTA.
Return JSON (no apostrophes): {"carousel_type":"product","product":"${product.name}","slides":[{"slide":1,"title":"...","body":"..."},{"slide":2,"title":"...","body":"..."},{"slide":3,"title":"...","body":"..."},{"slide":4,"title":"...","body":"..."},{"slide":5,"title":"...","body":"..."},{"slide":6,"title":"...","body":"..."},{"slide":7,"title":"...","body":"..."}]}`
    : `Generate a 7-slide educational carousel for bloom focus. Week ${weekNumber}.
Slides: 1)Bold hook + Save this, 2-6)One concept each, 7)Summary + CTA.
Return JSON (no apostrophes): {"carousel_type":"educational","topic":"the main topic","slides":[{"slide":1,"title":"...","body":"..."},{"slide":2,"title":"...","body":"..."},{"slide":3,"title":"...","body":"..."},{"slide":4,"title":"...","body":"..."},{"slide":5,"title":"...","body":"..."},{"slide":6,"title":"...","body":"..."},{"slide":7,"title":"...","body":"..."}]}`;

  const r = await client.messages.create({
    model: "claude-sonnet-4-6", max_tokens: 1500, system: SYSTEM,
    messages: [{ role: "user", content: prompt }]
  });
  return parseJSON(r.content[0].text);
}

// ─── Image prompts ────────────────────────────────────────────────────────────
const BASE_IMG = `Soft pastel digital illustration. Color palette: lavender #E8DEFF, cream #FFF8F0, sage green #D4E8D4, blush #FFD4E4, sky blue #D4EEFF. Flat vector with soft watercolor texture. No real people. No text or letters in image. Warm, calm, friendly.`;

function videoImagePrompt(script) {
  const additions = {
    1: "Abstract brain concept — neurons, thought bubbles, metaphorical lightbulb or sparks.",
    2: "Cozy comfort scene — warm cup of tea, soft blanket, gently lit desk.",
    3: "Organized calm workspace, open planner, simple illustrated elements.",
    4: "Interactive feel — checklist, quiz-style layout, Y/N visual.",
    5: `Illustrated product on pastel desk: "${script.product}". Minimal, inviting.`
  };
  return `${BASE_IMG} ${additions[script.pillar_id] ?? additions[1]} Vertical 9:16. Scene inspired by: "${script.hook}"`;
}

function pinterestImagePrompt(pin) {
  const streamAdditions = {
    etsy_product: `Illustrated product flat-lay: "${pin.product}". Soft desk scene, planner or toolkit.`,
    site_product: `Clean workspace with illustrated planner or worksheet: "${pin.product}".`,
    free_app: "Illustrated phone or tablet screen with soft gamified app UI. Plant growing, XP bar.",
    quiz_funnel: "Curious interactive visual — illustrated quiz cards, question marks, checklist.",
    blog_edu: "Educational ADHD brain illustration — neurons, thought flow, abstract concept."
  };
  return `${BASE_IMG} ${streamAdditions[pin.stream] ?? streamAdditions.blog_edu} Vertical 2:3 Pinterest format.`;
}

function storyImagePrompt(story) {
  const typeAdditions = {
    Poll: "Two contrasting abstract elements suggesting a choice. Playful, light energy.",
    Tip: "Single calm scene suggesting focus or clarity. Minimal, one focal point.",
    BTS: "Cozy behind-the-scenes feel — soft desk, notebook, warm light.",
    Quiz: "Curious engaging visual — checklist, question mark motif.",
    Product: "Illustrated product on soft pastel desk. Warm and inviting.",
    QA: "Open curious feeling — speech bubble motif, soft warm tones.",
    Reflection: "Gentle calm scene — evening light, plant, cup of tea. Peaceful."
  };
  return `${BASE_IMG} ${typeAdditions[story.type] ?? ""} Square 1:1 for Instagram Stories. Scene: "${story.headline}"`;
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
      results.image_prompts.videos.push({ id: `video_d${day+1}_s${slot+1}`, ...script, prompt: videoImagePrompt(script) });

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

  // ── 4. Carousels — 3 total ───────────────────────────────────────────────
  console.log("\n🎠 Generating carousels...");
  process.stdout.write("   Educational... ");
  const c1 = await generateCarousel("educational", weekNumber, 0);
  results.carousels.push(c1);
  results.image_prompts.carousels.push({ id: "carousel_edu", prompt: `${BASE_IMG} Educational ADHD concept illustration. 4:5 format. Topic: "${c1.topic}"` });
  console.log("✓");

  process.stdout.write("   Product #1... ");
  const c2 = await generateCarousel("product", weekNumber, 1);
  results.carousels.push(c2);
  results.image_prompts.carousels.push({ id: "carousel_product_1", prompt: `${BASE_IMG} Illustrated product: "${c2.product}". 4:5 format.` });
  console.log("✓");

  process.stdout.write("   Product #2... ");
  const c3 = await generateCarousel("product", weekNumber, 5);
  results.carousels.push(c3);
  results.image_prompts.carousels.push({ id: "carousel_product_2", prompt: `${BASE_IMG} Illustrated product: "${c3.product}". 4:5 format.` });
  console.log("✓");

  // ── Save ─────────────────────────────────────────────────────────────────
  const outputDir = path.join(__dirname, "../output");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const totalPins = results.pinterest_days.reduce((s, d) => s + d.pins.length, 0);
  const totalImgPrompts = results.image_prompts.videos.length + results.image_prompts.pinterest.length + results.image_prompts.stories.length + results.image_prompts.carousels.length;

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
