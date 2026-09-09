// =====================================================================
// STICKY MESSAGES
// /sticky posts a message that stays at the bottom of the channel: every
// time someone else sends a message, the old sticky is deleted and a
// fresh copy is posted underneath it. /unstick removes it.
//
// Storage is in-memory only (a Map), so stickies are lost on restart —
// re-run /sticky after a restart if you need them to persist.
// =====================================================================

const { EmbedBuilder } = require("discord.js");

const STICKY_COLOR = "#8B5CF6";

// channelId -> { content, messageId, posting }
const stickies = new Map();

function buildStickyEmbed(content, gifUrl) {
  const embed = new EmbedBuilder().setColor(STICKY_COLOR).setDescription(content);
  if (gifUrl) embed.setImage(gifUrl);
  return embed;
}

// Builds the actual message payload to send, based on whether this
// sticky is plaintext or an embed.
function buildStickyPayload(sticky) {
  if (sticky.plaintext) {
    const content = [sticky.content, sticky.gifUrl].filter(Boolean).join("\n");
    return { content };
  }
  return { embeds: [buildStickyEmbed(sticky.content, sticky.gifUrl)] };
}

async function setSticky(channel, content, { gifUrl = null, plaintext = false } = {}) {
  // Replace any existing sticky in this channel first.
  await removeSticky(channel);

  const sticky = { content, gifUrl, plaintext, messageId: null, posting: false };
  const message = await channel.send(buildStickyPayload(sticky));
  sticky.messageId = message.id;
  stickies.set(channel.id, sticky);
  return message;
}

async function removeSticky(channel) {
  const sticky = stickies.get(channel.id);
  if (!sticky) return false;

  stickies.delete(channel.id);

  const old = await channel.messages.fetch(sticky.messageId).catch(() => null);
  if (old) await old.delete().catch(() => {});

  return true;
}

function hasSticky(channelId) {
  return stickies.has(channelId);
}

// Called for every non-bot guild message; reposts the sticky underneath
// it if the channel has one.
async function handleMessageForSticky(message) {
  const sticky = stickies.get(message.channelId);
  if (!sticky) return;
  if (sticky.posting) return; // a repost is already in flight, don't stack them

  sticky.posting = true;
  try {
    const channel = message.channel;
    const old = await channel.messages.fetch(sticky.messageId).catch(() => null);
    if (old) await old.delete().catch(() => {});

    const fresh = await channel.send(buildStickyPayload(sticky));
    sticky.messageId = fresh.id;
  } catch (err) {
    console.error(`Failed to repost sticky in #${message.channel?.name}:`, err);
  } finally {
    sticky.posting = false;
  }
}

module.exports = { setSticky, removeSticky, hasSticky, handleMessageForSticky };
