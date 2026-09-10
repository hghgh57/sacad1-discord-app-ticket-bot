const { EmbedBuilder } = require("discord.js");
const { getStaffStats, getSponsorTotal, formatMoney } = require("./stats");

// userId -> { channelId, messageId } of the most recent /staff-stats card
// shown for them. In-memory only (not saved to disk) — if the bot restarts,
// old cards just stop auto-updating; running /staff-stats again re-links a
// fresh one. Only the most recently shown card per user is tracked, so if
// you run /staff-stats for the same person in two different channels, only
// the newer one keeps updating.
const liveCards = new Map();

function buildStatsEmbed(user) {
  const { claims, closes } = getStaffStats(user.id);
  const sponsored = getSponsorTotal(user.id);
  return new EmbedBuilder()
    .setColor("#8B5CF6")
    .setTitle(`📊 Stats for ${user.tag}`)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: "Claims", value: `${claims}`, inline: true },
      { name: "Closes", value: `${closes}`, inline: true },
      { name: "Total Sponsored", value: `$${formatMoney(sponsored)}`, inline: true }
    );
}

function registerCard(userId, message) {
  liveCards.set(userId, { channelId: message.channelId, messageId: message.id });
}

async function refreshCard(client, userId) {
  const ref = liveCards.get(userId);
  if (!ref) return;
  try {
    const channel = await client.channels.fetch(ref.channelId);
    const message = await channel.messages.fetch(ref.messageId);
    const user = await client.users.fetch(userId);
    await message.edit({ embeds: [buildStatsEmbed(user)] });
  } catch {
    // The card message (or channel) is gone, or we lost access to it —
    // drop the dead link so we're not retrying it forever.
    liveCards.delete(userId);
  }
}

async function refreshAllCards(client) {
  for (const userId of liveCards.keys()) {
    await refreshCard(client, userId);
  }
}

module.exports = { buildStatsEmbed, registerCard, refreshCard, refreshAllCards };
