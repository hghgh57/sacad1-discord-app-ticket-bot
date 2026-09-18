const fs = require("fs");
const path = require("path");

// JSON-file-backed, same pattern as locks.js/stats.js — needs to survive a
// restart, otherwise every open ticket would look "freshly active" after a
// redeploy and the 5-day auto-close timer would silently reset for all of
// them. channelId -> timestamp (ms) of the last message sent in that ticket.
const DATA_FILE = path.join(__dirname, "data", "ticketActivity.json");

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
    console.error("Failed to save ticketActivity.json:", err);
  }
}

const data = load(); // channelId -> last activity timestamp (ms)

function touchActivity(channelId) {
  data[channelId] = Date.now();
  save();
}

function getLastActivity(channelId) {
  return data[channelId];
}

function deleteActivity(channelId) {
  delete data[channelId];
  save();
}

module.exports = { touchActivity, getLastActivity, deleteActivity };
