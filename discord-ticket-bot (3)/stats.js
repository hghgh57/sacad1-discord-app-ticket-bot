const fs = require("fs");
const path = require("path");
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");

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
  data.staff[userId] ??= { claims: 0, closes: 0, renames: 0 };
  data.staff[userId].claims++;
  save();
}

function recordClose(userId) {
  data.staff[userId] ??= { claims: 0, closes: 0, renames: 0 };
  data.staff[userId].closes++;
  save();
}

function recordRename(userId) {
  data.staff[userId] ??= { claims: 0, closes: 0, renames: 0 };
  data.staff[userId].renames++;
  save();
}

function getStaffStats(userId) {
  return data.staff[userId] || { claims: 0, closes: 0, renames: 0 };
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

// =====================================================================
// LEADERBOARD — used by /ticket-leaderboard
// =====================================================================
const LEADERBOARD_FIELDS = {
  claims: { label: "Claims", emoji: "🤝" },
  closes: { label: "Closes", emoji: "🔒" },
  renames: { label: "Renames", emoji: "✏️" }
};

function buildLeaderboardMenu(selected) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("ticket_leaderboard_select")
      .setPlaceholder("Choose a leaderboard...")
      .addOptions(Object.entries(LEADERBOARD_FIELDS).map(([value, info]) => ({
        label: info.label,
        value,
        emoji: info.emoji,
        default: value === selected
      })))
  );
}

async function buildLeaderboardEmbed(client, field) {
  const info = LEADERBOARD_FIELDS[field] || LEADERBOARD_FIELDS.claims;

  const entries = Object.entries(data.staff)
    .map(([userId, s]) => [userId, s[field] || 0])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const lines = [];
  for (let i = 0; i < entries.length; i++) {
    const [userId, count] = entries[i];
    const user = await client.users.fetch(userId).catch(() => null);
    const name = user ? user.tag : `Unknown User (${userId})`;
    const rank = ["🥇", "🥈", "🥉"][i] || `**${i + 1}.**`;
    lines.push(`${rank} ${name} — **${count}**`);
  }

  return new EmbedBuilder()
    .setColor("#8B5CF6")
    .setTitle(`📊 ${info.emoji} ${info.label} Leaderboard`)
    .setDescription(lines.length ? lines.join("\n") : "No data yet.");
}

module.exports = {
  recordClaim,
  recordClose,
  recordRename,
  getStaffStats,
  getAllStaffStats,
  addSponsor,
  getSponsorTotal,
  resetUser,
  resetAll,
  formatMoney,
  buildLeaderboardEmbed,
  buildLeaderboardMenu
};
