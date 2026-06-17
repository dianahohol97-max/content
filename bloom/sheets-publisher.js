/**
 * bloom focus — sheets-publisher.js
 * Pushes the full weekly content pack to Google Sheets.
 * Creates tab "bloom_focus_week_XX" with all content for Diana to review.
 *
 * Prerequisites:
 *   1. Enable Google Sheets API in Google Cloud Console
 *   2. Create a Service Account and download credentials JSON
 *   3. Share your Google Sheet with the service account email
 *   4. Set env vars:
 *      GOOGLE_SHEETS_ID=your_spreadsheet_id
 *      GOOGLE_SERVICE_ACCOUNT_KEY=path/to/credentials.json (or JSON string)
 *
 * Usage:
 *   node bloom/sheets-publisher.js --week=26
 *   node bloom/sheets-publisher.js --week=26 --clear   (clear tab before pushing)
 */

import 'dotenv/config';
import { google } from "googleapis";
import fs from "fs";
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
const CLEAR_FIRST = !!args.clear;

if (!WEEK) {
  console.error("❌ --week is required. Example: node bloom/sheets-publisher.js --week=26");
  process.exit(1);
}

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
if (!SPREADSHEET_ID) {
  console.error("❌ GOOGLE_SHEETS_ID environment variable not set.");
  process.exit(1);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function getAuth() {
  const keyEnv = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  let credentials;
  if (keyEnv) {
    // Accept either a path or a raw JSON string
    try {
      credentials = JSON.parse(keyEnv);
    } catch {
      if (fs.existsSync(keyEnv)) {
        credentials = JSON.parse(fs.readFileSync(keyEnv, "utf-8"));
      } else {
        throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is neither valid JSON nor a file path.");
      }
    }
  } else {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY environment variable not set.");
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return auth;
}

// ─── Load weekly content pack ─────────────────────────────────────────────────
function loadWeeklyPack(weekNumber) {
  const filePath = path.join(
    __dirname,
    `../output/bloom_focus_week_${weekNumber}.json`
  );
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Week ${weekNumber} pack not found. Run text-generator.js --week=${weekNumber} first.`
    );
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

// ─── Ensure sheet tab exists ──────────────────────────────────────────────────
async function ensureSheetTab(sheets, spreadsheetId, tabName) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets.find(
    (s) => s.properties.title === tabName
  );

  if (existing) {
    if (CLEAR_FIRST) {
      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `'${tabName}'`,
      });
      console.log(`   🧹 Cleared existing tab: ${tabName}`);
    }
    return existing.properties.sheetId;
  }

  // Create the tab
  const addSheet = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: tabName,
              gridProperties: { rowCount: 200, columnCount: 20 },
            },
          },
        },
      ],
    },
  });

  console.log(`   ➕ Created new tab: ${tabName}`);
  return addSheet.data.replies[0].addSheet.properties.sheetId;
}

// ─── Build rows ───────────────────────────────────────────────────────────────
// Columns: ID | Pillar | Platform | Type | Hook | Body | CTA | Caption | ImagePrompt | ImagePath | VideoPath | Status | Notes
const HEADERS = [
  "ID",
  "Pillar",
  "Platform",
  "Type",
  "Hook",
  "Body / Slides",
  "CTA",
  "Caption (TikTok)",
  "Caption (IG)",
  "Image Prompt",
  "Image Path",
  "Video Path",
  "Pinterest Title",
  "Pinterest Description",
  "Status",
  "Notes",
  "Posted At",
];

function buildRows(pack) {
  const rows = [HEADERS];
  let rowId = 1;

  // ── Video scripts ──
  for (const script of pack.video_scripts) {
    const tiktokCaption = pack.tiktok_captions.find(
      (c) => c.pillar_id === script.pillar_id
    );
    const igCaption = pack.ig_captions.find(
      (c) => c.pillar_id === script.pillar_id
    );
    const imagePrompt = pack.image_prompts.image_prompts.find(
      (p) => p.id === `video_p${script.pillar_id}`
    );
    const video = pack.videos?.find((v) => v.pillar_id === script.pillar_id);

    rows.push([
      `W${pack.meta.week}_V${rowId++}`,
      script.pillar_name,
      "TikTok / IG Reels / YT Shorts",
      "Video Script",
      script.hook,
      script.body.join("\n• "),
      script.cta,
      tiktokCaption?.tiktok_caption ?? "",
      igCaption?.ig_caption ?? "",
      imagePrompt?.prompt ?? "",
      imagePrompt?.local_path ?? "",
      video?.path ?? "",
      "",
      "",
      "pending",
      "",
      "",
    ]);
  }

  // ── Carousels ──
  for (const carousel of pack.carousels) {
    const slidesSummary = carousel.slides
      .map((s) => `[${s.slide}] ${s.title}: ${s.body}`)
      .join("\n");

    const imagePrompt = pack.image_prompts.image_prompts.find(
      (p) => p.id === `carousel_${carousel.carousel_type}`
    );

    rows.push([
      `W${pack.meta.week}_C${rowId++}`,
      carousel.carousel_type === "product" ? "Behind the Product" : "This Is Your Brain",
      "IG Carousel",
      `Carousel (${carousel.carousel_type})`,
      carousel.slides[0].title,
      slidesSummary,
      carousel.slides[6].body,
      "",
      "",
      imagePrompt?.prompt ?? "",
      imagePrompt?.local_path ?? "",
      "",
      "",
      "",
      "pending",
      carousel.product ? `Product: ${carousel.product}` : "",
      "",
    ]);
  }

  // ── Stories ──
  for (const story of pack.stories.stories) {
    const bodyText =
      story.body ??
      story.question ??
      [story.poll_option_1, story.poll_option_2].filter(Boolean).join(" / ") ??
      "";

    const storyImagePrompt = pack.story_image_prompts?.find(
      (p) => p.day === story.day
    );

    rows.push([
      `W${pack.meta.week}_S${rowId++}`,
      "Mixed",
      "IG Stories",
      `Story (${story.type})`,
      story.headline,
      bodyText,
      story.cta ?? "",
      "",
      "",
      storyImagePrompt?.prompt ?? "",
      "",
      "",
      "",
      "",
      "pending",
      `${story.day.toUpperCase()} — ${story.note ?? ""}`,
      "",
    ]);
  }

  // ── Pinterest pins ──
  for (const pin of pack.pinterest.pins) {
    const pinImagePrompt = pack.pinterest_image_prompts?.find(
      (p) => p.id === `pinterest_pin_${pin.pin_number}`
    );

    rows.push([
      `W${pack.meta.week}_P${rowId++}`,
      "Mixed",
      "Pinterest",
      "Pin",
      pin.title,
      "",
      pin.link,
      "",
      "",
      pinImagePrompt?.prompt ?? "",
      "",
      "",
      pin.title,
      pin.description,
      "pending",
      `Keywords: ${pin.keywords.join(", ")}`,
      "",
    ]);
  }

  return rows;
}

// ─── Format header row ────────────────────────────────────────────────────────
async function formatSheet(sheets, spreadsheetId, sheetId) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        // Bold + background on header row
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.91, green: 0.87, blue: 1.0 }, // lavender
                textFormat: { bold: true, fontSize: 11 },
                verticalAlignment: "MIDDLE",
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)",
          },
        },
        // Freeze header row
        {
          updateSheetProperties: {
            properties: {
              sheetId,
              gridProperties: { frozenRowCount: 1 },
            },
            fields: "gridProperties.frozenRowCount",
          },
        },
        // Auto-resize columns
        {
          autoResizeDimensions: {
            dimensions: {
              sheetId,
              dimension: "COLUMNS",
              startIndex: 0,
              endIndex: HEADERS.length,
            },
          },
        },
        // Status column dropdown
        {
          setDataValidation: {
            range: {
              sheetId,
              startRowIndex: 1,
              endRowIndex: 200,
              startColumnIndex: HEADERS.indexOf("Status"),
              endColumnIndex: HEADERS.indexOf("Status") + 1,
            },
            rule: {
              condition: {
                type: "ONE_OF_LIST",
                values: [
                  { userEnteredValue: "pending" },
                  { userEnteredValue: "approved" },
                  { userEnteredValue: "rejected" },
                  { userEnteredValue: "posted" },
                  { userEnteredValue: "edit needed" },
                ],
              },
              showCustomUi: true,
              strict: true,
            },
          },
        },
      ],
    },
  });
}

// ─── Main runner ──────────────────────────────────────────────────────────────
async function publishToSheets(weekNumber) {
  console.log(`\n📊 bloom focus — publishing Week ${weekNumber} to Google Sheets\n`);
  console.log("━".repeat(50));

  const pack = loadWeeklyPack(weekNumber);
  const tabName = `bloom_focus_week_${weekNumber}`;

  // Auth
  process.stdout.write("   Authenticating with Google... ");
  const auth = await getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  console.log("✓");

  // Ensure tab
  process.stdout.write(`   Setting up tab "${tabName}"... `);
  const sheetId = await ensureSheetTab(sheets, SPREADSHEET_ID, tabName);
  console.log("✓");

  // Build rows
  process.stdout.write("   Building content rows... ");
  const rows = buildRows(pack);
  console.log(`✓ (${rows.length - 1} rows)`);

  // Write to Sheets
  process.stdout.write("   Writing to Google Sheets... ");
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabName}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
  console.log("✓");

  // Format
  process.stdout.write("   Applying formatting... ");
  await formatSheet(sheets, SPREADSHEET_ID, sheetId);
  console.log("✓");

  console.log("\n" + "━".repeat(50));
  console.log(`✅ Published to Google Sheets!`);
  console.log(`   📊 Tab: ${tabName}`);
  console.log(`   📋 Rows: ${rows.length - 1} content pieces`);
  console.log(`   🔗 https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`);
  console.log(`\n   ➜ Diana: review + set Status to "approved"`);
  console.log(`   ➜ Then: Make.com picks up "approved" rows and posts`);
  console.log("━".repeat(50) + "\n");
}

// ─── Run ──────────────────────────────────────────────────────────────────────
publishToSheets(WEEK).catch((err) => {
  console.error("\n❌ sheets-publisher failed:", err.message);
  process.exit(1);
});
