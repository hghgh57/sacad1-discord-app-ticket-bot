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

module.exports = {
  recordClaim,
  recordClose,
  getStaffStats,
  getAllStaffStats,
  addSponsor,
  getSponsorTotal,
  resetUser,
  resetAll
};
