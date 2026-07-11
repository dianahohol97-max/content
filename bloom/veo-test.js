// bloom focus — Veo universal-moment pilot: one 8s clip with a person
import fs from "fs";
import path from "path";

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error("no GEMINI_API_KEY"); process.exit(1); }

const PROMPT = `Cinematic vertical video. A moody late-night kitchen lit only by the warm glow of an open refrigerator. A young woman in a cozy oversized cardigan stands in front of the open fridge, staring blankly inside, completely still, lost in thought. She slowly closes the door, pauses for a beat, then opens it again and keeps staring. Soft lavender and warm cream tones with deep violet shadows, subtle film grain, shallow depth of field, refined editorial photography style, sophisticated adult mood. Quiet ambient refrigerator hum, no dialogue, no music, no text.`;

const MODELS = [
  "veo-3.1-fast-generate-preview",
  "veo-3.1-fast-generate-001",
  "veo-3.0-fast-generate-001",
];

const base = "https://generativelanguage.googleapis.com/v1beta";

async function tryModel(model) {
  console.log(`→ пробую модель: ${model}`);
  const res = await fetch(`${base}/models/${model}:predictLongRunning?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt: PROMPT }],
      parameters: { aspectRatio: "9:16", personGeneration: "allow_adult" },
    }),
  });
  const data = await res.json();
  if (!res.ok) { console.warn(`  ✗ ${res.status}: ${JSON.stringify(data).slice(0, 300)}`); return null; }
  return data.name;
}

async function main() {
  let opName = null;
  for (const m of MODELS) { opName = await tryModel(m); if (opName) break; }
  if (!opName) { console.error("Жодна модель не прийняла запит — див. помилки вище"); process.exit(1); }
  console.log(`⏳ операція: ${opName}`);

  let uri = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    const res = await fetch(`${base}/${opName}?key=${KEY}`);
    const op = await res.json();
    if (op.error) { console.error("операція впала:", JSON.stringify(op.error)); process.exit(1); }
    if (op.done) {
      const resp = op.response || {};
      const samples = resp.generateVideoResponse?.generatedSamples || resp.generatedVideos || [];
      const v = samples[0];
      uri = v?.video?.uri || v?.uri;
      if (!uri) { console.error("done, але без відео:", JSON.stringify(resp).slice(0, 500)); process.exit(1); }
      break;
    }
    process.stdout.write(".");
  }
  if (!uri) { console.error("таймаут очікування"); process.exit(1); }
  console.log(`\n✅ відео готове, качаю: ${uri.slice(0, 80)}...`);

  const sep = uri.includes("?") ? "&" : "?";
  const vres = await fetch(`${uri}${sep}key=${KEY}`);
  if (!vres.ok) { console.error(`download ${vres.status}`); process.exit(1); }
  const buf = Buffer.from(await vres.arrayBuffer());
  const outDir = path.join(process.cwd(), "output", "veo");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "UM_01_fridge_raw.mp4"), buf);
  console.log(`💾 output/veo/UM_01_fridge_raw.mp4 (${buf.length} байт)`);
}
main();
