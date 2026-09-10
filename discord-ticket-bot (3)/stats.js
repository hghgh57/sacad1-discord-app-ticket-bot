const fs = require("fs");
const path = require("path");

// Simple JSON-file-backed store — this bot has no database, and unlike the
// in-memory Maps elsewhere (snipe, afk, ticketClaims) this data is worth
// keeping across restarts. NOTE: if your host wipes the filesystem between
// deploys (e.g. some free-tier PaaS containers), this file won't survive
// that — you'd need a real database or a persistent volume for that case.
const DATA_FILE = path.join(__dirname, "data", "stats.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return { staff: {}, sponsors: {} };
  }
}

function save() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Failed to save stats.json:", err);
  }
}

const data = load();

function recordClaim(userId) {
  data.staff[userId] ??= { claims: 0, closes: 0 };
  data.staff[userId].claims++;
  save();
}

function recordClose(userId) {
  data.staff[userId] ??= { claims: 0, closes: 0 };
  data.staff[userId].closes++;
  save();
}

function getStaffStats(userId) {
  return data.staff[userId] || { claims: 0, closes: 0 };
}

function getAllStaffStats() {
  return data.staff;
}

// Returns the user's new running total after adding this sponsorship.
function addSponsor(userId, amount) {
  data.sponsors[userId] ??= 0;
  data.sponsors[userId] += amount;
  save();
  return data.sponsors[userId];
}

function getSponsorTotal(userId) {
  return data.sponsors[userId] || 0;
}

function resetUser(userId) {
  delete data.staff[userId];
  delete data.sponsors[userId];
  save();
}

function resetAll() {
  data.staff = {};
  data.sponsors = {};
  save();
}

// 1500 -> "1.5k", 10000000 -> "10m", 12345678 -> "12.3m", 10000000000 -> "10b"
function formatMoney(n) {
  const round1 = v => Math.round(v * 10) / 10;
  const abs = Math.abs(n);
  let val, suffix;
  if (abs >= 1e9) {
    val = round1(n / 1e9); suffix = "b";
  } else if (abs >= 1e6) {
    val = round1(n / 1e6); suffix = "m";
    if (Math.abs(val) >= 1000) { val = round1(n / 1e9); suffix = "b"; } // e.g. 999999999 -> 1b, not 1000m
  } else if (abs >= 1e3) {
    val = round1(n / 1e3); suffix = "k";
    if (Math.abs(val) >= 1000) { val = round1(n / 1e6); suffix = "m"; } // e.g. 999999 -> 1m, not 1000k
  } else {
    return n.toLocaleString();
  }
  return val + suffix;
}

module.exports = {
  recordClaim,
  recordClose,
  getStaffStats,
  getAllStaffStats,
  addSponsor,
  getSponsorTotal,
  resetUser,
  resetAll,
  formatMoney
};
