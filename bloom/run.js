/**
 * bloom focus — run.js
 * Master runner — runs all generators in sequence.
 *
 * Usage:
 *   node bloom/run.js --week=26               # full pipeline
 *   node bloom/run.js --week=26 --text-only   # text generation only
 *   node bloom/run.js --week=26 --no-video    # skip video assembly
 *   node bloom/run.js --week=26 --no-sheets   # skip Sheets publish
 *
 * Full pipeline:
 *   text-generator → image-generator → video-generator → sheets-publisher
 */

import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

const WEEK = args.week ? parseInt(args.week) : null;
const TEXT_ONLY = !!args["text-only"];
const NO_VIDEO = !!args["no-video"];
const NO_SHEETS = !!args["no-sheets"];

if (!WEEK) {
  console.error(`
❌ --week is required.

Usage examples:
  node bloom/run.js --week=26               full pipeline
  node bloom/run.js --week=26 --text-only   text only (skip images + video)
  node bloom/run.js --week=26 --no-video    skip video assembly
  node bloom/run.js --week=26 --no-sheets   skip Sheets publish
`);
  process.exit(1);
}

// ─── Run a step ───────────────────────────────────────────────────────────────
function runStep(label, command) {
  console.log(`\n${"═".repeat(55)}`);
  console.log(`  ${label}`);
  console.log("═".repeat(55));
  try {
    execSync(command, { stdio: "inherit", cwd: path.join(__dirname, "..") });
  } catch {
    console.error(`\n❌ Step failed: ${label}`);
    console.error("   Fix the error above and re-run from this step.");
    process.exit(1);
  }
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────
const startTime = Date.now();

console.log(`
╔══════════════════════════════════════════════════════╗
║         bloom focus — weekly content pipeline        ║
║                        Week ${WEEK}                        ║
╚══════════════════════════════════════════════════════╝
`);

const pipeline = [
  {
    label: "STEP 1/4 — Text Generation (Claude API)",
    cmd: `node bloom/text-generator.js --week=${WEEK}`,
    skip: false,
  },
  {
    label: "STEP 2/4 — Image Generation (DALL-E API)",
    cmd: `node bloom/image-generator.js --week=${WEEK}`,
    skip: TEXT_ONLY,
  },
  {
    label: "STEP 3/4 — Video Assembly (FFmpeg)",
    cmd: `node bloom/video-generator.js --week=${WEEK}`,
    skip: TEXT_ONLY || NO_VIDEO,
  },
  {
    label: "STEP 4/4 — Publish to Google Sheets",
    cmd: `node bloom/sheets-publisher.js --week=${WEEK}`,
    skip: NO_SHEETS,
  },
];

for (const step of pipeline) {
  if (step.skip) {
    console.log(`\n⏭  Skipping: ${step.label}`);
    continue;
  }
  runStep(step.label, step.cmd);
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

console.log(`
╔══════════════════════════════════════════════════════╗
║            ✅  Week ${WEEK} pipeline complete!            ║
║                 Finished in ${elapsed}s                      ║
╚══════════════════════════════════════════════════════╝

Output files:
  📄 output/bloom_focus_week_${WEEK}.json
  🖼  output/images/week_${WEEK}/
  🎬 output/videos/week_${WEEK}/

Next steps:
  1. Open Google Sheets → tab "bloom_focus_week_${WEEK}"
  2. Review each row (watch the hook + caption)
  3. Set Status = "approved" to queue for posting
  4. Make.com picks up approved rows automatically

Reddit posts (3/week) → MANUAL ONLY, never automated.
`);
