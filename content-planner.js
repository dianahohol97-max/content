/**
 * content-planner.js
 * Generates weekly content plan for all active projects
 * Output → Google Sheets "Plan" tab
 * 
 * Usage: node content-planner.js --week 25
 *        node content-planner.js --week 25 --project touchmemories
 */

import Anthropic from "@anthropic-ai/sdk";
import { google } from "googleapis";
import fs from "fs";
import path from "path";

// ─── Config ────────────────────────────────────────────────────────────────
const PROJECTS = JSON.parse(fs.readFileSync("./projects.json", "utf-8"));
const ANTHROPIC = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
const PLAN_TAB = "Plan";

// ─── Args ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const weekArg = args.find((a) => a.startsWith("--week"))?.split("=")[1] || args[args.indexOf("--week") + 1];
const projectArg = args.find((a) => a.startsWith("--project"))?.split("=")[1] || args[args.indexOf("--project") + 1];
const WEEK = weekArg || getCurrentWeek();
const TARGET_PROJECTS = projectArg ? [projectArg] : getActiveProjects();

function getCurrentWeek() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return String(Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7));
}

function getActiveProjects() {
  return Object.keys(PROJECTS.projects).filter(
    (id) => PROJECTS.projects[id].status === "active"
  );
}

// ─── Platform rules ─────────────────────────────────────────────────────────
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const ROTATION_RULES = {
  touchmemories: {
    Mon: [{ platform: "ig_reels", rubric: "ось_як", audience: "travel" }, { platform: "ig_stories", rubric: "zaraz_v_roboti", audience: "all" }],
    Tue: [{ platform: "ig_carousel", rubric: "вона_написала", audience: "rotate" }, { platform: "pinterest", rubric: "ось_як", audience: "rotate" }],
    Wed: [{ platform: "ig_reels", rubric: "ce_pro_tebe", audience: "rotate" }, { platform: "tiktok", rubric: "ось_як", audience: "rotate" }],
    Thu: [{ platform: "ig_carousel", rubric: "збережи", audience: "travel" }, { platform: "telegram", rubric: "ce_pro_tebe", audience: "rotate" }],
    Fri: [{ platform: "ig_reels", rubric: "bts", audience: "all" }, { platform: "yt_shorts", rubric: "ось_як", audience: "rotate" }],
    Sat: [{ platform: "pinterest", rubric: "підбірка", audience: "travel" }, { platform: "tiktok", rubric: "ce_pro_tebe", audience: "wedding_before" }],
    Sun: [{ platform: "ig_stories", rubric: "klient_dnya", audience: "rotate" }, { platform: "telegram", rubric: "вона_написала", audience: "rotate" }],
  },
  bloom_focus: {
    Mon: [{ platform: "tiktok", pillar: "pillar_2", audience: "adhd_adults" }, { platform: "ig_reels", pillar: "pillar_2", audience: "adhd_adults" }],
    Tue: [{ platform: "pinterest", pillar: "pillar_1", audience: "adhd_adults" }],
    Wed: [{ platform: "tiktok", pillar: "pillar_3", audience: "adhd_adults" }, { platform: "ig_reels", pillar: "pillar_3", audience: "adhd_adults" }],
    Thu: [{ platform: "yt_shorts", pillar: "pillar_4", audience: "adhd_adults" }],
    Fri: [{ platform: "tiktok", pillar: "pillar_1", audience: "adhd_adults" }, { platform: "ig_carousel", pillar: "pillar_1", audience: "adhd_adults" }],
    Sat: [{ platform: "reddit", pillar: "pillar_2", audience: "adhd_adults" }],
    Sun: [{ platform: "pinterest", pillar: "pillar_3", audience: "adhd_adults" }, { platform: "ig_stories", pillar: "pillar_4", audience: "adhd_adults" }],
  },
  vistela: {
    Mon: [{ platform: "tiktok", track: "demo", audience: "diy_brides" }, { platform: "ig_reels", track: "demo", audience: "diy_brides" }],
    Tue: [{ platform: "pinterest", track: "aesthetic", audience: "diy_brides" }],
    Wed: [{ platform: "tiktok", track: "aesthetic", audience: "diy_brides" }, { platform: "ig_carousel", track: "aesthetic", audience: "diy_brides" }],
    Thu: [{ platform: "yt_shorts", track: "demo", audience: "diy_brides" }],
    Fri: [{ platform: "tiktok", track: "demo", audience: "wedding_planners" }, { platform: "ig_reels", track: "aesthetic", audience: "diy_brides" }],
    Sat: [{ platform: "pinterest", track: "aesthetic", audience: "diy_brides" }],
    Sun: [{ platform: "ig_stories", track: "demo", audience: "diy_brides" }],
  },
};

// ─── Audience rotation ──────────────────────────────────────────────────────
const AUDIENCE_ROTATIONS = {
  touchmemories: ["gift_giver_f", "wedding_after", "travel", "gift_giver_m", "wedding_before", "travel", "gift_giver_f"],
};

let rotationIndex = {};

function getAudience(projectId, audienceId, dayIndex) {
  if (audienceId !== "rotate") return audienceId;
  const rotation = AUDIENCE_ROTATIONS[projectId];
  if (!rotation) return "all";
  const key = `${projectId}`;
  if (rotationIndex[key] === undefined) rotationIndex[key] = 0;
  const result = rotation[rotationIndex[key] % rotation.length];
  rotationIndex[key]++;
  return result;
}

// ─── Generate plan via Claude ────────────────────────────────────────────────
async function generateTopicsForProject(projectId, slots) {
  const project = PROJECTS.projects[projectId];
  if (!project) throw new Error(`Project ${projectId} not found`);

  const slotsText = slots
    .map(
      (s, i) =>
        `${i + 1}. ${s.day} | ${s.platform} | ${s.rubric || s.pillar || s.track} | audience: ${s.audience}`
    )
    .join("\n");

  const systemPrompt = buildSystemPrompt(project);
  const userPrompt = `Generate specific content topics for week ${WEEK}.

Project: ${project.label}
Language: ${project.language_label}
Mission: ${project.mission}

Content slots to fill:
${slotsText}

For each slot return a JSON array with objects:
{
  "slot_index": number,
  "topic": "specific topic in ${project.language_label}",
  "hook": "opening hook line",
  "format_notes": "brief format notes",
  "audience_note": "why this topic works for this audience"
}

Rules:
- Topics must be SPECIFIC, not generic
- Each topic must match the rubric/pillar/track goal
- No two consecutive posts for the same audience
- Language: ${project.language_label} for all content
- Never repeat topics from previous weeks

Return ONLY valid JSON array, no markdown.`;

  const response = await ANTHROPIC.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content[0].text.trim();
  return JSON.parse(text);
}

function buildSystemPrompt(project) {
  const forbidden = project.forbidden || project.forbidden_phrases || [];
  return `You are a content strategist for ${project.label}.

Mission: ${project.mission}
Tone: ${project.tone?.primary}
Voice: ${project.tone?.voice || project.tone?.secondary}
Never say: ${forbidden.join(", ")}

You generate specific, mission-aligned content topics that create genuine value.
You understand each audience deeply and match topics to their exact pain points and triggers.
Return only valid JSON, no explanations.`;
}

// ─── Build plan rows ─────────────────────────────────────────────────────────
function buildSlots(projectId) {
  const rotation = ROTATION_RULES[projectId];
  if (!rotation) return [];

  const slots = [];
  DAYS.forEach((day, dayIndex) => {
    const daySlots = rotation[day] || [];
    daySlots.forEach((slot) => {
      slots.push({
        day,
        dayIndex,
        platform: slot.platform,
        rubric: slot.rubric || null,
        pillar: slot.pillar || null,
        track: slot.track || null,
        audience: getAudience(projectId, slot.audience, dayIndex),
      });
    });
  });

  // Add daily stories
  DAYS.forEach((day) => {
    const storiesRubric = getStoriesRubric(projectId, day);
    slots.push({
      day,
      platform: "ig_stories",
      rubric: storiesRubric,
      audience: "all",
      auto: true,
    });
  });

  return slots;
}

function getStoriesRubric(projectId, day) {
  const schedule = {
    Mon: "zaraz_v_roboti",
    Tue: "klient_dnya",
    Wed: "qa",
    Thu: "do_pislia",
    Fri: "pidglyad",
    Sat: "travel_topic",
    Sun: "opytuvannya",
  };
  return schedule[day] || "zaraz_v_roboti";
}

// ─── Google Sheets ───────────────────────────────────────────────────────────
async function pushToPlanTab(rows) {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "./google-service-account.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  // Header row
  const header = [
    "Plan ID", "Week", "Project", "Day", "Platform",
    "Rubric / Pillar / Track", "Topic", "Audience",
    "Format Notes", "Hook Preview", "Status",
  ];

  const sheetRows = rows.map((row) => [
    row.plan_id,
    WEEK,
    row.project_id,
    row.day,
    row.platform,
    row.rubric || row.pillar || row.track || "",
    row.topic,
    row.audience,
    row.format_notes || "",
    row.hook || "",
    "⬜ Review",
  ]);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEETS_ID,
    range: `${PLAN_TAB}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [header, ...sheetRows] },
  });

  console.log(`✓ Pushed ${sheetRows.length} rows to Sheets → "${PLAN_TAB}" tab`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🗓  Content Planner — Week ${WEEK}`);
  console.log(`📦  Projects: ${TARGET_PROJECTS.join(", ")}\n`);

  const allRows = [];
  let planCounter = 1;

  for (const projectId of TARGET_PROJECTS) {
    console.log(`→ Planning: ${projectId}`);

    const slots = buildSlots(projectId);
    const nonAutoSlots = slots.filter((s) => !s.auto);

    let topics = [];
    try {
      topics = await generateTopicsForProject(projectId, nonAutoSlots);
      console.log(`  ✓ Generated ${topics.length} topics via Claude`);
    } catch (e) {
      console.error(`  ✗ Claude error: ${e.message}`);
      topics = nonAutoSlots.map((_, i) => ({ slot_index: i + 1, topic: "[TOPIC NEEDED]", hook: "", format_notes: "" }));
    }

    slots.forEach((slot, i) => {
      const topic = topics.find((t) => t.slot_index === i + 1) || {};
      allRows.push({
        plan_id: `W${WEEK}-${projectId.substring(0, 2).toUpperCase()}-${String(planCounter).padStart(3, "0")}`,
        project_id: projectId,
        day: slot.day,
        platform: slot.platform,
        rubric: slot.rubric || slot.pillar || slot.track,
        audience: slot.audience,
        topic: slot.auto ? `[Auto Stories: ${slot.rubric}]` : (topic.topic || "[TOPIC NEEDED]"),
        hook: slot.auto ? "" : (topic.hook || ""),
        format_notes: topic.format_notes || "",
      });
      planCounter++;
    });
  }

  // Push to Sheets if configured
  if (SHEETS_ID) {
    await pushToPlanTab(allRows);
  } else {
    // Output to console/file for now
    const outPath = `./output/plan-week-${WEEK}.json`;
    fs.mkdirSync("./output", { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(allRows, null, 2));
    console.log(`\n📄 Plan saved to ${outPath}`);
    console.log("   (Set GOOGLE_SHEETS_ID in .env to push to Sheets)\n");
  }

  console.log(`\n✅ Done — ${allRows.length} content slots planned for Week ${WEEK}`);
  console.log(`   Review in Google Sheets → change status to ✅ Approved`);
  console.log(`   Then run: node text-generator.js --week ${WEEK}\n`);
}

main().catch(console.error);
