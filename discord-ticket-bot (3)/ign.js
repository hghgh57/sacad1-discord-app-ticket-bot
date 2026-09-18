const fs = require("fs");
const path = require("path");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const config = require("./config");

// Simple JSON-file-backed store, same pattern as stats.js — { userId: "IGN" }.
const DATA_FILE = path.join(__dirname, "data", "ign.json");

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
    console.error("Failed to save ign.json:", err);
  }
}

const data = load();

function getIGN(userId) {
  return data[userId] || null;
}

// Returns the userId already using this IGN (case-insensitive), excluding
// the given user (so re-linking your own IGN doesn't flag itself), or null.
function findByIGN(ign, excludeUserId = null) {
  const lower = ign.toLowerCase();
  for (const [uid, storedIgn] of Object.entries(data)) {
    if (uid !== excludeUserId && storedIgn.toLowerCase() === lower) return uid;
  }
  return null;
}

function setIGN(userId, ign) {
  data[userId] = ign;
  save();
}

function removeIGN(userId) {
  const had = userId in data;
  if (had) {
    delete data[userId];
    save();
  }
  return had;
}

async function sendIGNPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(0x000000)
    .setTitle("Link Your Minecraft IGN")
    .setDescription(
      "Press the button below and enter your exact Minecraft IGN. It will be saved and added to your server nickname.\n" +
      "You can press the button again to update it."
    )
    .setFooter({ text: "IGN must be 3-16 letters, numbers, or underscores" });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("link_ign").setLabel("Link IGN").setStyle(ButtonStyle.Primary)
  );

  await channel.send({ embeds: [embed], components: [row] });
}

// action: "Linked" | "Updated" | "Unlinked"
async function logIGNEvent(guild, { action, user, ign, previousIgn, actionBy }) {
  if (!config.ignLogChannel) return;
  const channel = await guild.channels.fetch(config.ignLogChannel).catch(() => null);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(action === "Unlinked" ? 0xF04747 : 0x8B5CF6)
    .setTitle(`IGN ${action}`)
    .addFields(
      { name: "User", value: `${user}`, inline: true },
      { name: "IGN", value: `\`${ign}\``, inline: true }
    )
    .setTimestamp();

  if (previousIgn) {
    embed.addFields({ name: "Previous IGN", value: `\`${previousIgn}\``, inline: true });
  }
  if (actionBy) {
    embed.addFields({ name: actionBy.id === user.id ? "Linked by" : "Removed by", value: `${actionBy}`, inline: true });
  }

  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}

module.exports = { getIGN, findByIGN, setIGN, removeIGN, sendIGNPanel, logIGNEvent };
