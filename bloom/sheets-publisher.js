/**
 * bloom focus — sheets-publisher.js
 * Pushes weekly content pack to Google Sheets.
 *
 * Usage:
 *   node bloom/sheets-publisher.js --week=26
 */

import 'dotenv/config';
import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith("--"))
    .map(a => { const [k,v] = a.slice(2).split("="); return [k, v ?? true]; })
);
const WEEK = args.week ? parseInt(args.week) : null;
if (!WEEK) { console.error("❌ --week required"); process.exit(1); }

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
if (!SPREADSHEET_ID) { console.error("❌ GOOGLE_SHEETS_ID not set"); process.exit(1); }

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function getAuth() {
  const keyEnv = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  let credentials;
  try { credentials = JSON.parse(keyEnv); }
  catch { credentials = JSON.parse(fs.readFileSync(keyEnv, "utf-8")); }
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

// ─── Load pack ────────────────────────────────────────────────────────────────
function loadPack(weekNumber) {
  const p = path.join(__dirname, `../output/bloom_focus_week_${weekNumber}.json`);
  if (!fs.existsSync(p)) throw new Error(`Week ${weekNumber} pack not found. Run text-generator first.`);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

// ─── Ensure tab ───────────────────────────────────────────────────────────────
async function ensureTab(sheets, spreadsheetId, tabName) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets.find(s => s.properties.title === tabName);
  if (existing) {
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${tabName}'` });
    return existing.properties.sheetId;
  }
  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: tabName, gridProperties: { rowCount: 500, columnCount: 20 } } } }] }
  });
  return res.data.replies[0].addSheet.properties.sheetId;
}

// ─── Build rows ───────────────────────────────────────────────────────────────
const HEADERS = [
  "ID", "Day", "Platform", "Type", "Pillar / Stream",
  "Hook / Title", "Body / Slides", "CTA",
  "TikTok Caption", "IG Caption",
  "Image Prompt", "Image Path", "Video Path",
  "Pinterest Title", "Pinterest Description", "Pinterest Link", "Language",
  "Status", "Notes", "Posted At"
];

function buildRows(pack) {
  const rows = [HEADERS];
  let id = 1;
  const W = pack.meta.week;

  // ── Videos (21) ──
  for (const script of pack.video_scripts) {
    const cap = pack.tiktok_captions.find(c => c.day === script.day && c.slot === script.slot);
    const igCap = pack.ig_captions.find(c => c.day === script.day && c.slot === script.slot);
    const img = pack.image_prompts.videos.find(p => p.day === script.day && p.slot === script.slot);

    // Join all frame prompts with clear separators so each can be copied
    const framePrompts = img?.frames
      ? img.frames.map(f => `[FRAME ${f.frame} — ${f.segment}]\n${f.prompt}`).join("\n\n")
      : "";

    rows.push([
      `W${W}_V${String(id++).padStart(2,'0')}`,
      `Day ${script.day}`,
      "TikTok / IG Reels / YT Shorts",
      "Video Script",
      script.pillar_name,
      script.hook,
      script.body?.join("\n") ?? "",
      script.cta,
      cap?.tiktok_caption ?? "",
      igCap?.ig_caption ?? "",
      framePrompts,
      "", "",
      "", "", "", "en",
      "pending", `Slot ${script.slot} — ${img?.frames?.length ?? 0} frames — ${script.on_screen_text ?? ""}`, ""
    ]);
  }

  // ── Pinterest (70) ──
  for (const day of pack.pinterest_days) {
    for (const pin of day.pins) {
      const img = pack.image_prompts.pinterest.find(
        p => p.day === day.day && p.pin_number === pin.pin_number
      );
      rows.push([
        `W${W}_P${String(id++).padStart(2,'0')}`,
        `Day ${day.day}`,
        "Pinterest",
        `Pin (${pin.stream})`,
        pin.stream,
        pin.title,
        "",
        pin.cta,
        "", "",
        img?.prompt ?? "",
        "", "",
        pin.title,
        pin.description,
        pin.link,
        pin.lang ?? "en",
        "pending",
        `Keywords: ${(pin.keywords ?? []).join(", ")}`,
        ""
      ]);
    }
  }

  // ── Stories (7) ──
  for (const story of pack.stories.stories) {
    const body = story.body ?? story.question ??
      [story.poll_option_1, story.poll_option_2].filter(Boolean).join(" / ") ?? "";
    const img = pack.image_prompts.stories.find(p => p.day === story.day);

    rows.push([
      `W${W}_S${String(id++).padStart(2,'0')}`,
      story.day,
      "IG Stories",
      `Story (${story.type})`,
      "Mixed",
      story.headline,
      body,
      story.cta ?? "",
      "", "",
      img?.prompt ?? "",
      "", "",
      "", "", "", "en",
      "pending",
      `${story.day.toUpperCase()} — ${story.note ?? ""}`,
      ""
    ]);
  }

  // ── Carousels (3) ──
  for (const carousel of pack.carousels) {
    const slidesSummary = carousel.slides?.map(s => `[${s.slide}] ${s.title}: ${s.body}`).join("\n") ?? "";
    const img = pack.image_prompts.carousels.find(
      p => p.id === `carousel_${carousel.carousel_type}` ||
           p.id === `carousel_${carousel.carousel_type}_1` ||
           p.id === `carousel_${carousel.carousel_type}_2`
    );
    rows.push([
      `W${W}_C${String(id++).padStart(2,'0')}`,
      "—",
      "IG Carousel",
      `Carousel (${carousel.carousel_type})`,
      carousel.carousel_type === "product" ? "Behind the Product" : "This Is Your Brain",
      carousel.slides?.[0]?.title ?? "",
      slidesSummary,
      carousel.slides?.[6]?.body ?? "",
      "", "",
      img?.prompt ?? "",
      "", "",
      "", "", "", "en",
      "pending",
      carousel.product ? `Product: ${carousel.product}` : carousel.topic ?? "",
      ""
    ]);
  }

  return rows;
}

// ─── Format sheet ─────────────────────────────────────────────────────────────
async function formatSheet(sheets, spreadsheetId, sheetId) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.91, green: 0.87, blue: 1.0 },
                textFormat: { bold: true, fontSize: 11 },
                verticalAlignment: "MIDDLE",
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)",
          },
        },
        { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
        { autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: HEADERS.length } } },
        {
          setDataValidation: {
            range: { sheetId, startRowIndex: 1, endRowIndex: 500, startColumnIndex: HEADERS.indexOf("Status"), endColumnIndex: HEADERS.indexOf("Status") + 1 },
            rule: {
              condition: { type: "ONE_OF_LIST", values: [
                { userEnteredValue: "pending" }, { userEnteredValue: "approved" },
                { userEnteredValue: "rejected" }, { userEnteredValue: "posted" },
                { userEnteredValue: "edit needed" },
              ]},
              showCustomUi: true, strict: true,
            },
          },
        },
      ],
    },
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function publishToSheets(weekNumber) {
  console.log(`\n📊 bloom focus — publishing Week ${weekNumber} to Sheets\n${"━".repeat(50)}`);

  const pack = loadPack(weekNumber);
  const tabName = `bloom_focus_week_${weekNumber}`;

  process.stdout.write("   Authenticating... ");
  const auth = await getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  console.log("✓");

  process.stdout.write(`   Setting up tab "${tabName}"... `);
  const sheetId = await ensureTab(sheets, SPREADSHEET_ID, tabName);
  console.log("✓");

  process.stdout.write("   Building rows... ");
  const rows = buildRows(pack);
  console.log(`✓ (${rows.length - 1} rows)`);

  process.stdout.write("   Writing to Sheets... ");
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabName}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
  console.log("✓");

  process.stdout.write("   Formatting... ");
  await formatSheet(sheets, SPREADSHEET_ID, sheetId);
  console.log("✓");

  const summary = pack.meta.summary ?? {};
  console.log(`\n${"━".repeat(50)}`);
  console.log(`✅ Published!`);
  console.log(`   📊 Tab: ${tabName}`);
  console.log(`   📋 ${rows.length - 1} total rows:`);
  console.log(`   • ${summary.video_scripts ?? 0} videos`);
  console.log(`   • ${summary.pinterest_pins ?? 0} Pinterest pins`);
  console.log(`   • ${summary.stories ?? 0} Stories`);
  console.log(`   • ${summary.carousels ?? 0} Carousels`);
  console.log(`   🔗 https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`);
  console.log(`\n   ➜ Review + set Status = "approved" → Make.com posts automatically`);
  console.log(`${"━".repeat(50)}\n`);
}

publishToSheets(WEEK).catch(err => {
  console.error("\n❌ sheets-publisher failed:", err.message);
  process.exit(1);
});
