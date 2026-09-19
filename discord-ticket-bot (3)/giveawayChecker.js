const config = require("./config");

// Words that commonly show up in a giveaway-bot "winner" announcement.
// Used as a soft signal alongside the amount match, not a hard requirement.
const WINNER_WORDS = ["congratulations", "congrats", "winner", "winners", "won", "giveaway"];

// Parses a message like "50000", "$50,000", "50k" or "1.5m" into a plain
// number. Returns null if the message isn't (just) an amount, so we don't
// mistake ordinary chat for a claimed win amount.
function parseAmount(text) {
  if (!text) return null;

  const cleaned = text.trim().toLowerCase().replace(/,/g, "");
  const match = cleaned.match(/^\$?(\d+(?:\.\d+)?)\s*(k|m)?$/);
  if (!match) return null;

  let amount = parseFloat(match[1]);
  if (Number.isNaN(amount)) return null;

  if (match[2] === "k") amount *= 1000;
  if (match[2] === "m") amount *= 1000000;

  return amount;
}

// Pulls every money-like number out of a block of text (message content +
// embed title/description/fields), so we can compare each one against the
// amount the ticket opener typed.
function extractAmounts(text) {
  if (!text) return [];

  const cleaned = text.toLowerCase().replace(/,/g, "");
  const matches = cleaned.matchAll(/\$?(\d+(?:\.\d+)?)\s*(k|m)?\b/g);
  const amounts = [];

  for (const match of matches) {
    let amount = parseFloat(match[1]);
    if (Number.isNaN(amount)) continue;
    if (match[2] === "k") amount *= 1000;
    if (match[2] === "m") amount *= 1000000;
    amounts.push(amount);
  }

  return amounts;
}

// Concatenates all readable text on a message (content + embeds) into one
// string so mention/amount/keyword checks only need to scan it once.
function messageText(message) {
  const parts = [];

  if (message.content) parts.push(message.content);

  for (const embed of message.embeds || []) {
    if (embed.title) parts.push(embed.title);
    if (embed.description) parts.push(embed.description);
    for (const field of embed.fields || []) {
      if (field.name) parts.push(field.name);
      if (field.value) parts.push(field.value);
    }
  }

  return parts.join("\n");
}

function mentionsUser(text, userId) {
  return text.includes(`<@${userId}>`) || text.includes(`<@!${userId}>`) || text.includes(userId);
}

function amountsMatch(a, b) {
  return Math.abs(a - b) < 0.01;
}

// Scans every channel in config.giveawayCheck.channels for a message that
// both mentions the ticket owner and contains the amount they say they won.
// If config.giveawayCheck.botId is set, only that bot's messages are
// checked; leave it "" to check every message in those channels.
// Returns { configured, found, message } where message is
// { url, channelId, messageId, createdTimestamp } for the best match found
// across all configured channels.
async function findGiveawayWin(guild, ownerId, amount) {
  const gwConfig = config.giveawayCheck || {};
  const channelIds = (gwConfig.channels || []).filter(id => id && !id.startsWith("GIVEAWAY_CHANNEL_ID"));
  const botId = gwConfig.botId && !gwConfig.botId.startsWith("GIVEAWAY_BOT_") ? gwConfig.botId : null;

  if (!channelIds.length) {
    return { configured: false, found: false, message: null };
  }

  const limit = Math.max(50, Math.min(Number(gwConfig.searchLimit || 500), 5000));
  const matches = [];

  for (const channelId of channelIds) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) continue;

    let before;
    let scanned = 0;

    while (scanned < limit) {
      const batchSize = Math.min(100, limit - scanned);
      const options = { limit: batchSize, ...(before ? { before } : {}) };

      const batch = await channel.messages.fetch(options).catch(() => null);
      if (!batch || !batch.size) break;

      scanned += batch.size;

      for (const message of batch.values()) {
        if (botId && message.author.id !== botId) continue;

        const text = messageText(message);
        if (!text) continue;

        if (!mentionsUser(text, ownerId)) continue;

        const amountsInMessage = extractAmounts(text);
        const hasMatchingAmount = amountsInMessage.some(found => amountsMatch(found, amount));
        if (!hasMatchingAmount) continue;

        matches.push({
          url: message.url,
          channelId: channel.id,
          messageId: message.id,
          createdTimestamp: message.createdTimestamp,
          hasWinnerWord: WINNER_WORDS.some(word => text.toLowerCase().includes(word))
        });
      }

      const oldest = batch.last();
      if (!oldest || batch.size < batchSize) break;
      before = oldest.id;
    }
  }

  if (!matches.length) {
    return { configured: true, found: false, message: null };
  }

  // Prefer matches that also look like a winner announcement, then fall
  // back to the most recent match overall.
  matches.sort((a, b) => {
    if (a.hasWinnerWord !== b.hasWinnerWord) return a.hasWinnerWord ? -1 : 1;
    return b.createdTimestamp - a.createdTimestamp;
  });

  return { configured: true, found: true, message: matches[0] };
}

// Formats a plain number back into short form with a k/m/b suffix, e.g.
// 10000000 -> "10m", 50000 -> "50k", 1500000 -> "1.5m". Used so results are
// shown the way people actually type amounts, not as long raw numbers.
function formatAmountShort(amount) {
  const abs = Math.abs(amount);
  let value = amount;
  let suffix = "";

  if (abs >= 1_000_000_000) {
    value = amount / 1_000_000_000;
    suffix = "b";
  } else if (abs >= 1_000_000) {
    value = amount / 1_000_000;
    suffix = "m";
  } else if (abs >= 1_000) {
    value = amount / 1_000;
    suffix = "k";
  } else {
    return String(amount);
  }

  const rounded = Math.round(value * 100) / 100;
  return `${rounded}${suffix}`;
}

module.exports = {
  parseAmount,
  findGiveawayWin,
  formatAmountShort
};
