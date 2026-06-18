/**
 * bloom focus — Pinterest Generator
 * Generates 70 pins/week (10/day × 7 days)
 *
 * Distribution per day (4+3+2+1 funnel strategy):
 *   4 pins → bloomfocus.org/quiz     (cold — ADHD test)
 *   3 pins → bloomfocus.org          (warm — free printables / lead magnet)
 *   2 pins → etsy.com/shop/BloomfocusShop  (hot — product)
 *   1 pin  → bloomfocus.org/blog     (education / SEO authority)
 *
 * Output: JSON file + console log (ready to push to Google Sheets)
 *
 * Usage:
 *   node pinterest-generator.js --week=25
 *   node pinterest-generator.js --week=25 --day=1   (generate only 1 day)
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";

// ─── Config ──────────────────────────────────────────────────────────────────

const WEEK = parseInt(process.argv.find((a) => a.startsWith("--week="))?.split("=")[1] ?? "1");
const DAY_ONLY = process.argv.find((a) => a.startsWith("--day="))?.split("=")[1];

const DAYS = DAY_ONLY ? [parseInt(DAY_ONLY)] : [1, 2, 3, 4, 5, 6, 7];

const URLS = {
  quiz:      "https://bloomfocus.org/quiz",
  printable: "https://bloomfocus.org",
  etsy:      "https://etsy.com/shop/BloomfocusShop",
  blog:      "https://bloomfocus.org/blog",
};

const BOARDS = [
  "ADHD Tips & Science",
  "ADHD Productivity",
  "ADHD Planners & Printables",
  "ADHD Morning Routines",
  "Dopamine & Focus",
  "Neurodivergent Life",
];

const PRODUCTS = [
  "Dopamine Menu",
  "Hyperfocus Planner",
  "ADHD Daily Tracker",
  "Body Double Timer",
  "Task Initiation Kit",
  "ADHD Morning Routine Planner",
  "Executive Function Workbook",
];

const KEYWORD_SEEDS = [
  "ADHD planner printable",
  "ADHD morning routine",
  "dopamine menu ADHD",
  "task paralysis help",
  "ADHD productivity tips",
  "ADHD brain science",
  "ADHD motivation",
  "executive dysfunction",
  "body doubling ADHD",
  "ADHD habit tracker",
  "neurodivergent life hacks",
  "ADHD focus tips",
  "ADHD women",
  "ADHD daily routine",
  "ADHD organization system",
  "ADHD time blindness",
  "dopamine and ADHD",
  "ADHD self-care",
  "ADHD diagnosis adults",
  "ADHD coping strategies",
];

// Day→topic theme to keep variety across the week
const DAY_THEMES = {
  1: "morning routines and starting the day",
  2: "focus and task initiation",
  3: "emotional regulation and overwhelm",
  4: "organization systems and planners",
  5: "dopamine, motivation, and reward",
  6: "ADHD science and brain facts",
  7: "self-compassion and ADHD identity",
};

// ─── Anthropic client ─────────────────────────────────────────────────────────

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── JSON parser (robust) ─────────────────────────────────────────────────────

function parseJSON(raw) {
  // Strip markdown code fences
  let text = raw.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();

  // Replace Unicode curly quotes and em-dashes
  text = text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–|—/g, "-");

  // Remove control characters (except newline/tab)
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // Extract outermost [ ... ] or { ... }
  const arrStart = text.indexOf("[");
  const objStart = text.indexOf("{");

  if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
    const end = text.lastIndexOf("]");
    if (end !== -1) text = text.slice(arrStart, end + 1);
  } else if (objStart !== -1) {
    const end = text.lastIndexOf("}");
    if (end !== -1) text = text.slice(objStart, end + 1);
  }

  return JSON.parse(text);
}

// ─── Pin generator (single batch of 5) ───────────────────────────────────────

async function generatePinBatch({ funnel, url, theme, weekNum, dayNum, batchIndex, count = 5, attempt = 1 }) {
  const strictness = attempt === 1 ? "" : attempt === 2
    ? " CRITICAL: Use only straight ASCII apostrophes (') never curly quotes. No special characters."
    : " ULTRA STRICT: Plain ASCII only. No apostrophes at all if possible. Keep titles very short.";

  const funnelGuide = {
    quiz: `Goal: cold traffic. The user doesn't know if they have ADHD yet.
Hook style: "9 signs of ADHD in adult women", "Why you can't start tasks (ADHD quiz inside)", "Is this ADHD or just stress? Take the free test".
CTA in description: "Take the free ADHD quiz at bloomfocus.org/quiz"`,

    printable: `Goal: warm traffic. The user suspects/knows they have ADHD and wants tools.
Hook style: "Free ADHD habit tracker (download now)", "The ADHD planner that finally works — free printable", "ADHD morning routine checklist — free PDF".
CTA in description: "Get your free ADHD printable at bloomfocus.org"`,

    etsy: `Goal: hot traffic. The user is ready to buy a solution.
Hook style: "ADHD Dopamine Menu — finally a planner that works", "The ADHD planner designed by an ADHD brain", "Task Initiation Kit for ADHD — get unstuck fast".
Products available: ${PRODUCTS.join(", ")}.
CTA in description: "Shop ADHD planners and tools at etsy.com/shop/BloomfocusShop"`,

    blog: `Goal: SEO authority and education. Long-tail search traffic.
Hook style: "Why ADHD brains can't just focus (neuroscience)", "ADHD time blindness explained", "Dopamine and ADHD: the science behind motivation".
CTA in description: "Read the full guide at bloomfocus.org/blog"`,
  };

  const prompt = `You are a Pinterest SEO expert for bloom focus, an ADHD digital products brand.

Generate exactly ${count} Pinterest pins for the "${funnel}" funnel.
Week: ${weekNum}, Day: ${dayNum}, Batch: ${batchIndex}
Theme for this day: ${theme}
Destination URL: ${url}

FUNNEL GUIDANCE:
${funnelGuide[funnel]}

PINTEREST RULES:
- Title: 40-60 chars, keyword-rich long-tail phrase (specific beats generic)
  BAD: "ADHD tips"
  GOOD: "ADHD morning routine when you can't get out of bed"
- Description: 150-300 chars, 3-5 relevant keywords naturally embedded, end with destination URL
- imagePrompt: Detailed prompt for DALL-E. Style: "Soft pastel digital illustration, flat vector with watercolor texture. Palette: lavender #E8DEFF, cream #FFF8F0, sage green #D4E8D4, blush #FFD4E4. No real people, no text in image. Vertical 2:3 format." Add scene detail relevant to pin topic.
- board: Choose the most relevant from: ${BOARDS.join(" | ")}
- Each pin must have a DIFFERENT title, angle, and imagePrompt (not just paraphrases of the same idea)
- Pins ${batchIndex > 1 ? "in this second batch" : "in this first batch"} must be on different sub-topics within the theme${strictness}

Return ONLY a valid JSON array, no markdown, no explanation:
[
  {
    "title": "...",
    "description": "...",
    "imagePrompt": "...",
    "board": "...",
    "destinationUrl": "${url}",
    "funnel": "${funnel}"
  }
]`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  return parseJSON(response.content[0].text);
}

// ─── Retry wrapper ────────────────────────────────────────────────────────────

async function generatePinBatchWithRetry(params) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const pins = await generatePinBatch({ ...params, attempt });
      if (!Array.isArray(pins) || pins.length === 0) throw new Error("Empty array");
      console.log(`    ✓ batch ${params.batchIndex} (${params.funnel}) — ${pins.length} pins`);
      return pins;
    } catch (err) {
      console.warn(`    ✗ attempt ${attempt} failed: ${err.message}`);
      if (attempt === 3) {
        console.warn(`    ⚠ using fallback for ${params.funnel} batch ${params.batchIndex}`);
        return Array.from({ length: params.count ?? 5 }, (_, i) => ({
          title: `ADHD ${params.funnel} tip ${params.batchIndex}-${i + 1}`,
          description: `Helpful ADHD content for ${params.theme}. Visit ${params.url}`,
          imagePrompt: "Soft pastel digital illustration of a cozy desk with planners and plants. Lavender and cream palette. No text. Vertical 2:3 format.",
          board: BOARDS[0],
          destinationUrl: params.url,
          funnel: params.funnel,
        }));
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

// ─── Generate one day (10 pins) ───────────────────────────────────────────────
//
// Distribution: 4 quiz + 3 printable + 2 etsy + 1 blog
// Split into batches of 5 to avoid JSON issues:
//   Batch 1: 3 quiz + 2 printable
//   Batch 2: 1 quiz + 1 printable + 2 etsy + 1 blog

async function generateDay(weekNum, dayNum) {
  const theme = DAY_THEMES[dayNum] ?? "ADHD productivity and focus";
  console.log(`\n📅 Day ${dayNum} — theme: ${theme}`);

  // Batch 1: 3 quiz + 2 printable (5 pins)
  const batch1a = await generatePinBatchWithRetry({
    funnel: "quiz", url: URLS.quiz, theme, weekNum, dayNum, batchIndex: 1, count: 3,
  });

  const batch1b = await generatePinBatchWithRetry({
    funnel: "printable", url: URLS.printable, theme, weekNum, dayNum, batchIndex: 1, count: 2,
  });

  // Batch 2: 1 quiz + 1 printable + 2 etsy + 1 blog (5 pins)
  const batch2a = await generatePinBatchWithRetry({
    funnel: "quiz", url: URLS.quiz, theme, weekNum, dayNum, batchIndex: 2, count: 1,
  });

  const batch2b = await generatePinBatchWithRetry({
    funnel: "printable", url: URLS.printable, theme, weekNum, dayNum, batchIndex: 2, count: 1,
  });

  const batch2c = await generatePinBatchWithRetry({
    funnel: "etsy", url: URLS.etsy, theme, weekNum, dayNum, batchIndex: 1, count: 2,
  });

  const batch2d = await generatePinBatchWithRetry({
    funnel: "blog", url: URLS.blog, theme, weekNum, dayNum, batchIndex: 1, count: 1,
  });

  const allPins = [...batch1a, ...batch1b, ...batch2a, ...batch2b, ...batch2c, ...batch2d];

  // Add metadata
  return allPins.map((pin, i) => ({
    id: `W${weekNum}_D${dayNum}_${String(i + 1).padStart(2, "0")}`,
    week: weekNum,
    day: dayNum,
    pinNumber: i + 1,
    ...pin,
    status: "pending",
    postedAt: null,
  }));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🌸 bloom focus Pinterest Generator`);
  console.log(`   Week ${WEEK} | Days: ${DAYS.join(", ")} | ${DAYS.length * 10} pins total\n`);

  const allPins = [];

  for (const day of DAYS) {
    const dayPins = await generateDay(WEEK, day);
    allPins.push(...dayPins);
    console.log(`   → ${dayPins.length} pins generated for day ${day}`);

    // Pause between days to be kind to the API
    if (DAYS.indexOf(day) < DAYS.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // ── Save output ──────────────────────────────────────────────────────────
  const outputFile = `pinterest_week_${WEEK}.json`;
  fs.writeFileSync(outputFile, JSON.stringify(allPins, null, 2), "utf8");

  // ── Summary ──────────────────────────────────────────────────────────────
  const byFunnel = allPins.reduce((acc, p) => {
    acc[p.funnel] = (acc[p.funnel] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`\n✅ Done! ${allPins.length} pins generated`);
  console.log(`   Breakdown: ${Object.entries(byFunnel).map(([k, v]) => `${k}: ${v}`).join(" | ")}`);
  console.log(`   Output: ${outputFile}`);
  console.log(`\nNext step: run sheets-publisher.js to push to Google Sheets`);

  return allPins;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
