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
//       id, guildId, channelId, createdBy, createdAt, weekStart,
//       headerMessageId,               // the top "overview" message — no pings in it
//       userMessages: { [userId]: messageId }, // one message PER tracked user
//       users: [userId, ...],
//       stats: { [userId]: { claims, closes, renames, sponsors } } // sponsors = $ total
//     }
//   ],
//   lastResetDateKey: "YYYY-MM-DD" // Sydney-local date the weekly reset last ran, so we don't double-fire
// }
//
// Why one message per user instead of one big embed with everyone in it:
// Discord only fires an @mention NOTIFICATION for a mention sitting in a
// message's plain CONTENT — never for one inside an embed (field name,
// field value, description, whatever). So to actually ping someone right
// at their own section of the tracker, that section has to BE its own
// message, with the mention in its content and that user's stats in the
// embed underneath it. The old design pinged everyone in one line at the
// top of a single combined-embed message; this one pings each person
// individually, right above their own card, and the top message carries
// no pings at all.
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
// EMBEDS
// =====================================================================
function buildHeaderEmbed(tracker, { stopped = false } = {}) {
  const weekStartUnix = Math.floor(new Date(tracker.weekStart).getTime() / 1000);
  return new EmbedBuilder()
    .setColor(stopped ? "#F04747" : "#8B5CF6")
    .setTitle(stopped ? "📊 Weekly Activity Tracker — Stopped" : "📊 Weekly Activity Tracker")
    .setDescription(
      `Tracking **${tracker.users.length}** user(s) • updates live below\n` +
      `Week started <t:${weekStartUnix}:D> • resets every **Sunday at midnight (Sydney time)**`
    )
    .setFooter({ text: `Tracker ID: ${tracker.id}` })
    .setTimestamp();
}

// Each user gets their own small card. Their name doesn't need to be
// spelled out here — the real @mention above the embed (in that message's
// content) already identifies whose section this is, and that's the part
// that actually notifies them.
function buildUserEmbed(tracker, userId, { stopped = false } = {}) {
  const s = tracker.stats[userId] || blankStats();
  return new EmbedBuilder()
    .setColor(stopped ? "#F04747" : "#8B5CF6")
    .setDescription(
      `🤝 Claims: **${s.claims}**\n` +
      `🔒 Closes: **${s.closes}**\n` +
      `✏️ Renames: **${s.renames}**\n` +
      `💸 Sponsored: **$${formatMoney(s.sponsors)}**`
    )
    .setFooter({ text: `Tracker ID: ${tracker.id}` });
}

async function refreshHeaderMessage(client, tracker, opts = {}) {
  try {
    const channel = await client.channels.fetch(tracker.channelId);
    const message = await channel.messages.fetch(tracker.headerMessageId);
    await message.edit({ embeds: [buildHeaderEmbed(tracker, opts)] });
  } catch {
    console.warn(`⚠️  Couldn't refresh tracker ${tracker.id}'s header — its message or channel may have been deleted.`);
  }
}

// Refreshes just ONE user's card. This is the common case (a claim/close/
// rename/sponsor just happened for one person) so it only costs one
// message edit instead of touching everyone else's section too.
async function refreshUserMessage(client, tracker, userId, opts = {}) {
  const messageId = tracker.userMessages[userId];
  if (!messageId) return;
  try {
    const channel = await client.channels.fetch(tracker.channelId);
    const message = await channel.messages.fetch(messageId);
    await message.edit({ embeds: [buildUserEmbed(tracker, userId, opts)] });
  } catch {
    console.warn(`⚠️  Couldn't refresh tracker ${tracker.id}'s card for user ${userId} — its message or channel may have been deleted.`);
  }
}

async function refreshTrackerEmbed(client, tracker, opts = {}) {
  await refreshHeaderMessage(client, tracker, opts);
  await Promise.all(tracker.users.map(userId => refreshUserMessage(client, tracker, userId, opts)));
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
    headerMessageId: null,
    userMessages: {},
    createdBy,
    createdAt: new Date().toISOString(),
    weekStart: new Date().toISOString(),
    users: [...userIds],
    stats: Object.fromEntries(userIds.map(id => [id, blankStats()]))
  };

  // Header first (no pings — just the overview), then one message per
  // tracked user, each pinging that one person right above their own card.
  const headerMessage = await channel.send({ embeds: [buildHeaderEmbed(tracker)] });
  tracker.headerMessageId = headerMessage.id;

  for (const userId of tracker.users) {
    const userMessage = await channel.send({
      content: `<@${userId}>`,
      embeds: [buildUserEmbed(tracker, userId)]
    });
    tracker.userMessages[userId] = userMessage.id;
  }

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

  // Just re-colors/re-titles the existing header + user cards to show the
  // tracker is stopped — doesn't touch each message's content, so nobody
  // gets re-pinged just because the tracker ended.
  await refreshTrackerEmbed(client, tracker, { stopped: true });

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

  // Only that user's own card needs to change — no reason to touch anyone
  // else's section (or re-ping anyone) over one person's event.
  await Promise.all(relevant.map(t => refreshUserMessage(client, t, userId)));
}

async function recordTrackerSponsor(client, guildId, userId, amount) {
  const relevant = data.trackers.filter(t => t.guildId === guildId && t.users.includes(userId));
  if (!relevant.length) return;

  for (const t of relevant) {
    t.stats[userId] ??= blankStats();
    t.stats[userId].sponsors += amount;
  }
  save();

  await Promise.all(relevant.map(t => refreshUserMessage(client, t, userId)));
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
      // Plain notice, no mentions — the per-user cards below just update
      // in place, so nobody needs (or gets) pinged again for the reset.
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
