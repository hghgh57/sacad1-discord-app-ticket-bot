const { EmbedBuilder } = require("discord.js");

// =====================================================================
// STICKY MESSAGES
// /sticky posts a message that stays at the bottom of the channel:
// every time someone else sends a message, the old sticky is deleted
// and a fresh copy is posted underneath it. /unstick removes it.
//
// Storage is in-memory only (a Map), so stickies are lost on restart —
// re-run /sticky after a restart if you need them to persist.
// =====================================================================

// channelId -> { content, messageId, posting, pending }
const stickies = new Map();

function buildStickyEmbed(content) {
  return new EmbedBuilder()
    .setColor("#8B5CF6")
    .setDescription(content)
    .setFooter({ text: "📌 Sticky Message" });
}

async function setSticky(channel, content) {
  // Replace any existing sticky in this channel first.
  await removeSticky(channel);

  const message = await channel.send({ embeds: [buildStickyEmbed(content)] });
  stickies.set(channel.id, { content, messageId: message.id, posting: false, pending: false });
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

// Deletes the current sticky message and posts a fresh copy underneath
// whatever was just sent, so it always ends up at the very bottom.
async function repost(channel, sticky) {
  sticky.posting = true;
  try {
    const old = await channel.messages.fetch(sticky.messageId).catch(() => null);
    if (old) await old.delete().catch(() => {});

    const fresh = await channel.send({ embeds: [buildStickyEmbed(sticky.content)] });
    sticky.messageId = fresh.id;
  } catch (err) {
    console.error(`Failed to repost sticky in #${channel?.name}:`, err);
  } finally {
    sticky.posting = false;
    // If more messages came in while we were reposting, do one more
    // repost right after this one finishes, so the sticky still ends up
    // at the bottom instead of getting left behind during busy chat.
    if (sticky.pending) {
      sticky.pending = false;
      await repost(channel, sticky);
    }
  }
}

// Called for every non-bot guild message; reposts the sticky underneath
// it if the channel has one.
async function handleMessageForSticky(message) {
  const sticky = stickies.get(message.channelId);
  if (!sticky) return;

  if (sticky.posting) {
    // A repost is already in flight — don't stack calls, just make sure
    // one more happens right after it, so we don't fall behind.
    sticky.pending = true;
    return;
  }

  await repost(message.channel, sticky);
}

module.exports = { setSticky, removeSticky, hasSticky, handleMessageForSticky };
