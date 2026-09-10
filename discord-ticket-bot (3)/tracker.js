const fs = require("fs");
const path = require("path");
const { EmbedBuilder } = require("discord.js");
const { formatMoney } = require("./stats");

// =====================================================================
// WEEKLY ACTIVITY TRACKER
// Separate from stats.js (the all-time /staff-stats numbers) on purpose —
// this is a rolling, admin-configured weekly leaderboard that lives in one
// message per tracker and edits itself live. You can have more than one
// tracker running at once (different groups posting to different channels).
//
// Data shape (data/trackers.json):
// {
//   trackers: [
//     {
//       id, guildId, channelId, messageId, createdBy, createdAt, weekStart,
//       users: [userId, ...],
//       stats: { [userId]: { claims, closes, renames, sponsors } } // sponsors = $ total
//     }
//   ],
//   lastResetDateKey: "YYYY-MM-DD" // Sydney-local date the weekly reset last ran, so we don't double-fire
// }
// =====================================================================
const DATA_FILE = path.join(__dirname, "data", "trackers.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return { trackers: [], lastResetDateKey: null };
  }
}

function save() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Failed to save trackers.json:", err);
  }
}

const data = load();

function genId() {
  return `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function blankStats() {
  return { claims: 0, closes: 0, renames: 0, sponsors: 0 };
}

// =====================================================================
// EMBED
// =====================================================================
// NOTE: Discord renders @mentions inside embed field VALUES, but NOT inside
// field NAMES — a mention in a name just shows up as literal raw text like
// "<@123456789012345678>". So instead of mentioning them in the name, we
// fetch each tracked user and use their actual username there, with a
// clickable mention kept in the value as a bonus.
async function buildTrackerEmbed(client, tracker) {
  const weekStartUnix = Math.floor(new Date(tracker.weekStart).getTime() / 1000);
  const embed = new EmbedBuilder()
    .setColor("#8B5CF6")
    .setTitle("📊 Weekly Activity Tracker")
    .setDescription(
      `Tracking **${tracker.users.length}** user(s) • updates live\n` +
      `Week started <t:${weekStartUnix}:D> • resets every **Sunday at midnight (Sydney time)**`
    )
    .setFooter({ text: `Tracker ID: ${tracker.id}` })
    .setTimestamp();

  for (const userId of tracker.users) {
    const s = tracker.stats[userId] || blankStats();
    const user = await client.users.fetch(userId).catch(() => null);
    const displayName = user ? user.username : `Unknown User (${userId})`;

    embed.addFields({
      name: `👤 ${displayName}`,
      value:
        `<@${userId}>\n` +
        `🤝 Claims: **${s.claims}**\n` +
        `🔒 Closes: **${s.closes}**\n` +
        `✏️ Renames: **${s.renames}**\n` +
        `💸 Sponsored: **$${formatMoney(s.sponsors)}**`,
      inline: true
    });
  }

  return embed;
}

async function refreshTrackerEmbed(client, tracker) {
  try {
    const channel = await client.channels.fetch(tracker.channelId);
    const message = await channel.messages.fetch(tracker.messageId);
    await message.edit({ embeds: [await buildTrackerEmbed(client, tracker)] });
  } catch {
    console.warn(`⚠️  Couldn't refresh tracker ${tracker.id} — its message or channel may have been deleted.`);
  }
}

// =====================================================================
// CRUD
// =====================================================================
async function createTracker(client, guild, channelId, userIds, createdBy) {
  const channel = await guild.channels.fetch(channelId);

  const tracker = {
    id: genId(),
    guildId: guild.id,
    channelId,
    messageId: null,
    createdBy,
    createdAt: new Date().toISOString(),
    weekStart: new Date().toISOString(),
    users: [...userIds],
    stats: Object.fromEntries(userIds.map(id => [id, blankStats()]))
  };

  const message = await channel.send({ embeds: [await buildTrackerEmbed(client, tracker)] });
  tracker.messageId = message.id;

  data.trackers.push(tracker);
  save();
  return tracker;
}

function getGuildTrackers(guildId) {
  return data.trackers.filter(t => t.guildId === guildId);
}

function getTracker(id) {
  return data.trackers.find(t => t.id === id);
}

async function stopTracker(client, id) {
  const idx = data.trackers.findIndex(t => t.id === id);
  if (idx === -1) return null;
  const [tracker] = data.trackers.splice(idx, 1);
  save();

  try {
    const channel = await client.channels.fetch(tracker.channelId);
    const message = await channel.messages.fetch(tracker.messageId);
    const stoppedEmbed = EmbedBuilder.from(await buildTrackerEmbed(client, tracker))
      .setTitle("📊 Weekly Activity Tracker — Stopped")
      .setColor("#F04747");
    await message.edit({ embeds: [stoppedEmbed] });
  } catch {
    // message/channel already gone — nothing to clean up visually
  }

  return tracker;
}

// =====================================================================
// EVENT HOOKS — called from index.js / ticket-rename.js / sponsor-add.js
// =====================================================================
async function recordTrackerEvent(client, guildId, userId, field) {
  const relevant = data.trackers.filter(t => t.guildId === guildId && t.users.includes(userId));
  if (!relevant.length) return;

  for (const t of relevant) {
    t.stats[userId] ??= blankStats();
    t.stats[userId][field]++;
  }
  save();

  await Promise.all(relevant.map(t => refreshTrackerEmbed(client, t)));
}

async function recordTrackerSponsor(client, guildId, userId, amount) {
  const relevant = data.trackers.filter(t => t.guildId === guildId && t.users.includes(userId));
  if (!relevant.length) return;

  for (const t of relevant) {
    t.stats[userId] ??= blankStats();
    t.stats[userId].sponsors += amount;
  }
  save();

  await Promise.all(relevant.map(t => refreshTrackerEmbed(client, t)));
}

// =====================================================================
// WEEKLY RESET — every Sunday at midnight, Australia/Sydney (NSW) time.
// "Sunday 12 at night" is the instant Sunday rolls into Monday, i.e.
// Monday 00:00 local time — that's what RESET_WEEKDAY/HOUR/MINUTE below
// point at. Uses Intl with an explicit timezone so daylight saving
// (AEST/AEDT) is handled automatically — no manual offset math needed.
// =====================================================================
const RESET_TIMEZONE = "Australia/Sydney";
const RESET_WEEKDAY = "Mon";
const RESET_HOUR = 0;
const RESET_MINUTE = 0;

function getSydneyParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: RESET_TIMEZONE,
    weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  });
  const map = {};
  for (const p of fmt.formatToParts(date)) map[p.type] = p.value;
  return {
    weekday: map.weekday,
    dateKey: `${map.year}-${map.month}-${map.day}`,
    hour: parseInt(map.hour, 10),
    minute: parseInt(map.minute, 10)
  };
}

async function performWeeklyReset(client) {
  for (const tracker of data.trackers) {
    for (const userId of tracker.users) tracker.stats[userId] = blankStats();
    tracker.weekStart = new Date().toISOString();
  }
  save();

  for (const tracker of data.trackers) {
    try {
      const channel = await client.channels.fetch(tracker.channelId);
      await channel.send("📅 **Weekly reset** — everyone's stats below are back to 0 for the new week.").catch(() => {});
    } catch {
      // channel gone — refreshTrackerEmbed below will just warn and move on
    }
    await refreshTrackerEmbed(client, tracker);
  }
}

// Checked every 20s (not every minute) so the reset still fires promptly
// even if the event loop is a little busy right at the boundary.
function startWeeklyResetScheduler(client) {
  setInterval(() => {
    const { weekday, dateKey, hour, minute } = getSydneyParts();
    if (weekday !== RESET_WEEKDAY || hour !== RESET_HOUR || minute !== RESET_MINUTE) return;
    if (data.lastResetDateKey === dateKey) return; // already reset in this same check-window
    data.lastResetDateKey = dateKey;
    save();
    performWeeklyReset(client).catch(err => console.error("Weekly tracker reset failed:", err));
  }, 20_000);
}

module.exports = {
  createTracker,
  getGuildTrackers,
  getTracker,
  stopTracker,
  recordTrackerEvent,
  recordTrackerSponsor,
  startWeeklyResetScheduler
};
