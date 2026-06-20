/**
 * bloom focus — tts.js
 * Shared text-to-speech with two engines + automatic fallback.
 *
 *   engine "elevenlabs" → ElevenLabs (best quality; uses ELEVENLABS_API_KEY)
 *   engine "gemini"     → Gemini TTS (free with GEMINI_API_KEY; great for long-form)
 *
 * Pick via the VOICE_ENGINE env var or the `engine` argument.
 * If ElevenLabs fails (e.g. out of credits / no key), we automatically fall
 * back to Gemini so a run never dies on audio.
 *
 * Both return an MP3 file at outPath.
 *
 * Env:
 *   ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID (optional, default warm female)
 *   GEMINI_API_KEY, GEMINI_TTS_VOICE (optional, default "Kore")
 *   VOICE_ENGINE (optional, "elevenlabs" | "gemini")
 */

import fs from "fs";
import { execSync } from "child_process";

const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // Rachel, warm female
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_VOICE = process.env.GEMINI_TTS_VOICE || "Kore"; // calm, clear female
const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";

// ── ElevenLabs (MP3 out) ──────────────────────────────────────────────────────
async function elevenLabs(text, outPath) {
  if (!ELEVEN_KEY) throw new Error("ELEVENLABS_API_KEY missing");
  // Flash model = 0.5 credit/char (cheapest). Override with ELEVENLABS_MODEL.
  const model = process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5";
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE}`, {
    method: "POST",
    headers: { "xi-api-key": ELEVEN_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 160)}`);
  fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
  return outPath;
}

// ── Gemini TTS (returns PCM/WAV → we transcode to MP3 with ffmpeg) ─────────────
async function geminiTTS(text, outPath) {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY missing");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: `Say this warmly and conversationally, like a kind friend explaining something — natural pace, gentle, not robotic, with a little emphasis on the key phrases:\n\n${text}` }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICE } } },
    },
  });

  // Gemini TTS occasionally returns transient 500/503/429. Retry with backoff
  // so a single hiccup doesn't kill an entire long-form render.
  let part = null;
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    } catch (netErr) {
      // network blip → treat as transient
      if (attempt === maxAttempts) throw new Error(`Gemini TTS network error after ${maxAttempts} attempts: ${netErr.message}`);
      const wait = 3000 * attempt;
      console.warn(`      ⚠ Gemini TTS network error — retry ${attempt}/${maxAttempts - 1} in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (res.ok) {
      const data = await res.json();
      part = (data.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData) || null;
      if (part) break;
      // 200 but no audio → treat as transient and retry
    }
    const status = res.ok ? "no-audio" : res.status;
    const transient = res.ok || [429, 500, 502, 503, 504].includes(res.status);
    if (!transient) throw new Error(`Gemini TTS ${res.status}: ${(await res.text()).slice(0, 160)}`);
    if (attempt === maxAttempts) throw new Error(`Gemini TTS failed after ${maxAttempts} attempts (last: ${status})`);
    const wait = 3000 * attempt; // 3s, 6s, 9s, 12s, 15s
    console.warn(`      ⚠ Gemini TTS ${status} — retry ${attempt}/${maxAttempts - 1} in ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
  }

  // Gemini returns raw PCM (24kHz, 16-bit, mono) base64. Wrap as WAV, then → MP3.
  const pcm = Buffer.from(part.inlineData.data, "base64");
  const wavPath = outPath.replace(/\.mp3$/i, "") + ".wav";
  fs.writeFileSync(wavPath, pcmToWav(pcm, 24000, 1, 16));
  // transcode to mp3 so downstream ffmpeg steps behave identically to ElevenLabs
  execSync(`ffmpeg -y -i "${wavPath}" -codec:a libmp3lame -q:a 2 "${outPath}"`, { stdio: "ignore" });
  fs.rmSync(wavPath, { force: true });
  return outPath;
}

function pcmToWav(pcm, sampleRate, channels, bitsPerSample) {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * makeVoiceover(text, outPath, engine?)
 * engine: "elevenlabs" | "gemini" | undefined (→ VOICE_ENGINE env, default elevenlabs)
 * Falls back to Gemini if ElevenLabs throws.
 */
export async function makeVoiceover(text, outPath, engine) {
  const chosen = engine || process.env.VOICE_ENGINE || "elevenlabs";
  if (chosen === "gemini") return geminiTTS(text, outPath);
  try {
    return await elevenLabs(text, outPath);
  } catch (err) {
    console.warn(`   ⚠ ElevenLabs failed (${err.message}) — falling back to Gemini TTS`);
    return geminiTTS(text, outPath);
  }
}
