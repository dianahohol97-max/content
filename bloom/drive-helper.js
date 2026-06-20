/**
 * bloom focus — drive-helper.js
 * Uploads files to Google Drive and returns shareable links.
 * Auto-creates subfolders (images/week_XX, videos/week_XX).
 */

import { google } from "googleapis";
import fs from "fs";

function getAuth() {
  const keyEnv = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  let credentials;
  try { credentials = JSON.parse(keyEnv); }
  catch { credentials = JSON.parse(fs.readFileSync(keyEnv, "utf-8")); }
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
}

let _drive = null;
function drive() {
  if (!_drive) _drive = google.drive({ version: "v3", auth: getAuth() });
  return _drive;
}

// Cache folder IDs so we don't recreate them
const _folderCache = {};

/** Find or create a subfolder under a parent folder */
export async function ensureFolder(name, parentId) {
  const cacheKey = `${parentId}/${name}`;
  if (_folderCache[cacheKey]) return _folderCache[cacheKey];

  // Search for existing folder
  const res = await drive().files.list({
    q: `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id, name)",
    spaces: "drive",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (res.data.files.length > 0) {
    _folderCache[cacheKey] = res.data.files[0].id;
    return res.data.files[0].id;
  }

  // Create it
  const folder = await drive().files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
    supportsAllDrives: true,
  });
  _folderCache[cacheKey] = folder.data.id;
  return folder.data.id;
}

/** Upload a local file to a Drive folder, return shareable link.
 *  Supports Shared Drives via supportsAllDrives. */
export async function uploadFile(localPath, fileName, folderId, mimeType = "image/png") {
  const file = await drive().files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: fs.createReadStream(localPath) },
    fields: "id, webViewLink, webContentLink",
    supportsAllDrives: true,
  });

  await drive().permissions.create({
    fileId: file.data.id,
    requestBody: { role: "reader", type: "anyone" },
    supportsAllDrives: true,
  });

  return {
    id: file.data.id,
    viewLink: file.data.webViewLink,
    downloadLink: `https://drive.google.com/uc?export=download&id=${file.data.id}`,
    directLink: `https://drive.google.com/uc?id=${file.data.id}`,
  };
}

/** Build the folder path: root → category → week_XX */
export async function ensureWeekFolder(rootId, category, weekNumber) {
  const catFolder = await ensureFolder(category, rootId);
  const weekFolder = await ensureFolder(`week_${weekNumber}`, catFolder);
  return weekFolder;
}
