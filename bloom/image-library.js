/**
 * bloom focus — image-library.js
 * A self-filling library of generated illustrations, reused across videos so
 * we don't regenerate (and don't repeat) the same scenes.
 *
 * Each scene has a TAG (e.g. "brain", "desk_messy", "window_light"). For every
 * tag we keep up to MAX_VARIANTS images. When a scene needs an image:
 *   - if the tag already has MAX_VARIANTS variants → reuse a RANDOM one
 *   - else → generate a new one, save it as the next variant, and use it
 * So the library matures over time and Gemini usage drops the longer it runs.
 *
 * Library lives in the repo at output/library/{aspect}/{tag}_{n}.png and is
 * committed (kept forever — it has a size ceiling: tags * MAX_VARIANTS).
 * Finished videos are cleaned up separately; the library is not.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

export const MAX_VARIANTS = 5;

function libDir(aspect) {
  // aspect: "vertical" (9:16 shorts/stories) or "wide" (16:9 longform)
  const d = path.join(REPO_ROOT, "output", "library", aspect);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// normalize a tag into a safe filename token
export function normalizeTag(tag) {
  return String(tag || "scene")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "scene";
}

function variantsFor(aspect, tag) {
  const dir = libDir(aspect);
  const t = normalizeTag(tag);
  return fs.readdirSync(dir).filter((f) => f.startsWith(`${t}_`) && f.endsWith(".png"));
}

/**
 * getOrCreate(tag, aspect, generateFn, copyTo)
 * - tag: scene category (string)
 * - aspect: "vertical" | "wide"
 * - generateFn: async () => Buffer  (generates a NEW image when needed)
 * - copyTo: destination path to place the chosen image for this scene
 * Returns { path: copyTo, reused: boolean, tag }
 */
export async function getOrCreate(tag, aspect, generateFn, copyTo) {
  const dir = libDir(aspect);
  const t = normalizeTag(tag);
  const existing = variantsFor(aspect, tag);

  if (existing.length >= MAX_VARIANTS) {
    // reuse a random existing variant
    const pick = existing[Math.floor(Math.random() * existing.length)];
    fs.copyFileSync(path.join(dir, pick), copyTo);
    return { path: copyTo, reused: true, tag: t };
  }

  // generate a new variant, store it, then use it
  const buf = await generateFn();
  const n = existing.length + 1;
  const libPath = path.join(dir, `${t}_${n}.png`);
  fs.writeFileSync(libPath, buf);
  fs.copyFileSync(libPath, copyTo);
  return { path: copyTo, reused: false, tag: t };
}

export function libraryStats(aspect) {
  const dir = libDir(aspect);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png"));
  const tags = {};
  for (const f of files) {
    const tag = f.replace(/_\d+\.png$/, "");
    tags[tag] = (tags[tag] || 0) + 1;
  }
  return { total: files.length, tags };
}

// Write a manifest of all library images as an array of {id, url}, so a Make
// scenario can read it and archive the photos to Dropbox (backgrounds for
// Stories / carousels). Written to output/library/manifest.json.
const REPO_RAW = "https://raw.githubusercontent.com/dianahohol97-max/content/main";
export function writeLibraryManifest() {
  const all = [];
  for (const aspect of ["vertical", "wide"]) {
    const dir = libDir(aspect);
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".png"))) {
      all.push({ id: `${aspect}_${f}`, aspect, filename: f, url: `${REPO_RAW}/output/library/${aspect}/${f}` });
    }
  }
  const out = path.join(REPO_ROOT, "output", "library", "manifest.json");
  fs.writeFileSync(out, JSON.stringify(all, null, 2));
  return all.length;
}
