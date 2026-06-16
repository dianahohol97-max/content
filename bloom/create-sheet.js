/**
 * Creates the bloom focus Google Sheet and sets it up
 */
import { google } from "googleapis";

const SERVICE_ACCOUNT = {
  "type": "service_account",
  "project_id": "innate-plexus-289618",
  "private_key_id": "456dfbd5c0286566fe4b60739ffbe8aca617f641",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDCn96TZxI+pnW7\nBoDbJaMSAosWQkZDALTZFtANX49Nb4xy2A2gx5SkFXSj9QCC23I3BP/XuahYxGNM\nUf33yOVNjq0LiGrpzxtO8M74EcMGGS5YvTl9PGkmhNsRgvYmJTAJeG2QWPvPdiUN\nwlI7KuDqgcFCboelBWOJoSqJ6tpamK6xafQnHath/fyOzumV0sx9Vy2YVfB187Ty\nnYTUjXeVeeHF8qyZMnZnhrYmZJhEaW0J5sFAMscBsP6JRN4kbluUweFHrxLEtU/x\n+P/3DyylauC5txFJuF/OAD414PoKKTZVIPymRQt18YxgcqAvpLDtaPmVzHohV703\nIYwRPJ3NAgMBAAECggEADOhCAEU/U4JXSnkARghf9ot5TUJF8J71Ch9WMEeHHxvn\nv5y5LVGEd8FTLqXKoThhLGmbd2NrrmoP1SRBkz5H3ss4igxDsuU2VWzo/Ptd6Lig\nzJJ4DpMuvLbmOb9qswBCXaPBTb0TriA9YtqL+OU7bLIARCHvwwTxeKjZ7l2cmjy/\nsxdF5s26F9aApt/MhUKv6+8hXPlcggyQw4lXQ6JSnhZqqwgdB22+laM6VovGuAna\ncJbdRRPSrdy7OQ3jngiOd2UuCw656Diklzlq6syuko6sQiXCz7R0WCQcMhXTAX6m\n3taFTcXUtTbW6STdNRMTNetRA9RxZl+LdPcnIuxuYQKBgQDlSDXyxFfzlpcVouEU\n6q+zrG7xYZ+pnF2mjrf/MIb11tgBHsHeKDWzlMqVMsxdI9kjfLiADAL3EAbWh4bx\nASD0tn1BT3V8iUUP7Kov/24jYr9aoI5Rtd6vbNbuHz1v9eovbinmiHnzRXCtJOsU\nqdi+VbRYLmDMPU3A68796EpPlQKBgQDZTcbiJQIEqlLn8KJWL8SmRwTIyGN0S/dP\nvmuIIrl4Wvic2ib3bHIb77SIMoNTToz18i048Q3/jc37c5vrxKOzUtUy+Hlgu/cz\nmcFsguSNnWGsff7GSMu6CxncdK6CUyHtqgAC4MPIPVS/lZ7tZhd67WTdI8u7Y8b3\nkmEO81pnWQKBgQCScbvbcmMGt4GKlT0UQg21QgaecA8toy0BzBhjixg4f1/53y5O\nefpK2FdIUmjLeLEhBHFHf+SI7xie/3NGDcWB5+k6xMiyoW6WDEBrZcdwHItCFFiy\ngepYu7jP4O45y6UnZEKo9zSFGC4uuOzZht5kO5Nz2zOCYAmAllzgOfT0vQKBgQCQ\nN91B4zvWqs/BHWQv/R3vGP0k4FGZMn2dUAx/2kPri7yqJOJtnWyR++F97sBXvq8w\n35yByQH4VD2bn5uguu3GKrhSTrQHrlgex/GmOazEC+pyF2DKai/DdnCgblQPLGs9\nF3FQd6mYMJQZXoyOlA4LSJiDZ6lj4ZGAZ4bA7GNYaQKBgGdRpmpbjNJGv4Yl97xJ\naBhQLvG+Kmme5aIfGfPLPBAYHBvYVJAYp17GiFWC8bE0GLVdnuI1fGDN7FUykVz+\nk6+Oit64ovG7La61vPFJBrsy+hQPTPugSozwbKf5Bi/0nMx7yoI45lLhRN7zzkKS\n2wR6R+fnk/NvKVFJgf1OE9Xh\n-----END PRIVATE KEY-----\n",
  "client_email": "bloom-focus@innate-plexus-289618.iam.gserviceaccount.com",
  "client_id": "108619429680754494490",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token"
};

const auth = new google.auth.GoogleAuth({
  credentials: SERVICE_ACCOUNT,
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
  ],
});

const sheets = google.sheets({ version: "v4", auth });
const drive = google.drive({ version: "v3", auth });

// Create the spreadsheet
const spreadsheet = await sheets.spreadsheets.create({
  requestBody: {
    properties: {
      title: "bloom focus — Content Queue",
      locale: "en_US",
      timeZone: "Europe/Kiev",
    },
    sheets: [
      { properties: { title: "README", index: 0 } },
    ],
  },
});

const spreadsheetId = spreadsheet.data.spreadsheetId;
const url = spreadsheet.data.spreadsheetUrl;

console.log("✅ Spreadsheet created!");
console.log("   ID:", spreadsheetId);
console.log("   URL:", url);

// Add README content
await sheets.spreadsheets.values.update({
  spreadsheetId,
  range: "README!A1",
  valueInputOption: "RAW",
  requestBody: {
    values: [
      ["bloom focus — Content Queue"],
      [""],
      ["HOW IT WORKS"],
      ["1. Every Monday, text-generator.js creates a new tab: bloom_focus_week_XX"],
      ["2. Review each row — check hook, caption, image prompt"],
      ["3. Set Status = 'approved' to queue for posting"],
      ["4. Make.com picks up approved rows and posts automatically"],
      [""],
      ["STATUS VALUES"],
      ["pending", "Not reviewed yet"],
      ["approved", "Ready to post — Make.com will pick this up"],
      ["rejected", "Do not post"],
      ["edit needed", "Needs changes before approving"],
      ["posted", "Already published"],
      [""],
      ["PLATFORMS"],
      ["TikTok", "Manual upload (API restricted)"],
      ["Instagram Reels", "Auto via Make.com"],
      ["Instagram Stories", "Auto via Make.com"],
      ["Instagram Carousel", "Auto via Make.com"],
      ["YouTube Shorts", "Auto via Make.com"],
      ["Pinterest", "Auto via Make.com"],
      ["Reddit", "MANUAL ONLY — never automated"],
    ],
  },
});

// Format README tab
const sheetId = spreadsheet.data.sheets[0].properties.sheetId;
await sheets.spreadsheets.batchUpdate({
  spreadsheetId,
  requestBody: {
    requests: [
      // Title row bold + lavender
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.91, green: 0.87, blue: 1.0 },
              textFormat: { bold: true, fontSize: 14 },
            },
          },
          fields: "userEnteredFormat(backgroundColor,textFormat)",
        },
      },
      // Section headers bold
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 2, endRowIndex: 3 },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: "userEnteredFormat(textFormat)",
        },
      },
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 8, endRowIndex: 9 },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: "userEnteredFormat(textFormat)",
        },
      },
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 15, endRowIndex: 16 },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: "userEnteredFormat(textFormat)",
        },
      },
      // Auto-resize columns
      {
        autoResizeDimensions: {
          dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 3 },
        },
      },
    ],
  },
});

// Share with Diana's Google account so she can open it
// (Service account owns it — we need to share to make it accessible)
await drive.permissions.create({
  fileId: spreadsheetId,
  requestBody: {
    role: "writer",
    type: "anyone",  // anyone with link can edit — Diana can open without extra steps
  },
});

console.log("\n🔗 Open in browser:");
console.log("   " + url);
console.log("\n📋 GOOGLE_SHEETS_ID =", spreadsheetId);
