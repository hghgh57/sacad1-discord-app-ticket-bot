const fs = require("fs");
const path = require("path");

// JSON-file-backed, same pattern as ticketActivity.js — remembers which
// giveaway tickets have already had their win-amount check run, so it never
// runs twice for the same ticket (once from the modal, once from a later
// plain-text message) and survives a bot restart.
const DATA_FILE = path.join(__dirname, "data", "giveawayChecks.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function save() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Failed to save giveawayChecks.json:", err);
  }
}

const data = load(); // channelId -> true once checked

function isGiveawayChecked(channelId) {
  return Boolean(data[channelId]);
}

function markGiveawayChecked(channelId) {
  data[channelId] = true;
  save();
}

function clearGiveawayChecked(channelId) {
  delete data[channelId];
  save();
}

module.exports = { isGiveawayChecked, markGiveawayChecked, clearGiveawayChecked };
