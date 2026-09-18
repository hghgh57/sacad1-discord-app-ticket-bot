const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextInputStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags
} = require("discord.js");
const config = require("./config");

// =====================================================================
// TICKET SYSTEM
// Each ticket type has its own emoji, label, and modal questions.
// question.style: TextInputStyle.Short (one line) or .Paragraph (multi-line)
// question.placeholder is optional extra hint text shown in the empty field.
// =====================================================================
const tickets = {
  buying: {
    emoji: "🦴",
    label: "Buying Spawners",
    questions: [
      { label: "What's your IGN?", style: TextInputStyle.Short },
      { label: "How many are you buying?", style: TextInputStyle.Short }
    ]
  },
  selling: {
    emoji: "🦴",
    label: "Sell Spawners",
    questions: [
      { label: "What's your IGN?", style: TextInputStyle.Short },
      { label: "How many are you selling?", style: TextInputStyle.Short }
    ]
  },
  partnership: {
    emoji: "🤝",
    label: "Partnership",
    questions: [
      { label: "How many members does your server have?", style: TextInputStyle.Short },
      { label: "Can you send your ad straight away?", style: TextInputStyle.Short }
    ]
  },
  giveaway: {
    emoji: "💵",
    label: "Giveaway Claim/Sponsor",
    questions: [
      { label: "How much did you win?", style: TextInputStyle.Short },
      { label: "What's your IGN?", style: TextInputStyle.Short },
      {
        label: "Can you provide an uncropped screenshot?",
        style: TextInputStyle.Short,
        placeholder: "Yes/No - attach it in the ticket once it's created"
      }
    ]
  },
  gamble: {
    emoji: "🤑",
    label: "Missed Gamble",
    questions: [
      { label: "What happened?", style: TextInputStyle.Paragraph },
      { label: "How much was missed?", style: TextInputStyle.Short },
      { label: "What is your IGN?", style: TextInputStyle.Short }
    ]
  },
  help: {
    emoji: "⚙️",
    label: "General Help",
    questions: [
      { label: "What is the problem?", style: TextInputStyle.Paragraph }
    ]
  }
};

// =====================================================================
// TICKET PANEL
// Sent as a Components V2 message (Container + separators) instead of a
// plain embed, so it can hold long formatted rules text with dividers.
// The select menu lives inside the same container, at the bottom.
// =====================================================================
async function sendTicketPanel(channel) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("ticket")
    .setPlaceholder("Select...")
    .addOptions(Object.entries(tickets).map(([k, v]) => ({
      label: v.label,
      value: k,
      emoji: v.emoji,
      description: "Click on this option to create a ticket"
    })));

  const container = new ContainerBuilder()
    .setAccentColor(0x000000)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "# 🎫 WHAT TO OPEN A TICKET FOR :\n" +
        "- Buying or selling Skeleton Spawners.(Please check ⁠#『🦴』➺spawner-prices before opening a ticket about Skeleton Spawners.)\n\n" +
        "- Claiming a giveaway prize.\n\n" +
        "- General support or questions.\n\n" +
        "- Reporting a member for breaking server rules.(Server issues only — NOT DonutSMP related.)\n\n" +
        "- Sponsoring a giveaway.\n\n" +
        "- Partnership requests.(Please check ⁠<#1480179580995375187> before opening a partnership ticket.)\n\n" +
        "- Other server-related help."
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "**⚠️ We are NOT DonutSMP staff.**\n" +
        "Please do not open tickets for DonutSMP issues."
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## ❌ DO NOT OPEN A TICKET FOR :\n" +
        "**(Doing any of these may result in a timeout.)**\n\n" +
        "- Trolling or wasting staff time.\n" +
        "- Spam opening tickets.\n" +
        "- Begging for money/items.\n" +
        "- Fake reports or unnecessary tickets."
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## 📝 IMPORTANT NOTES :\n" +
        "Staff will NEVER privately DM you first.\n" +
        "Please be patient while waiting for staff responses.\n" +
        "Do not ping staff repeatedly in tickets."
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(menu)
    );

  await channel.send({
    flags: MessageFlags.IsComponentsV2,
    components: [container]
  });
}

// =====================================================================
// BUY AD PANEL
// A single button (no dropdown, no modal) — clicking it opens a ticket
// straight away in config.buyAd.category and pings config.buyAd.roles.
// =====================================================================
async function sendBuyAdPanel(channel) {
  const e = new EmbedBuilder()
    .setColor("#8B5CF6")
    .setTitle("Buy Ad")
    .setDescription("Buy a ad");
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("buyad_ticket").setLabel("Buy now").setStyle(ButtonStyle.Primary)
  );
  await channel.send({ embeds: [e], components: [row] });
}

// =====================================================================
// TICKET LOGGING
// Sent as a Components V2 message (Container + separators) so it can use
// real headers (##/###) instead of plain embed fields.
//
// Pass:
//   title       - e.g. "Ticket Closed", "Ticket Claimed", "Ticket Renamed"
//   ticketChannel - the ticket's channel (mentionable) or a channel mention string
//   category    - display name for what kind of ticket this is
//   openedBy    - (optional) user/mention who originally opened the ticket.
//                 Omit this for claim/unclaim/rename logs — only
//                 open/close logs show who opened the ticket.
//   actionLabel - heading for who performed this action, e.g. "Closed by",
//                 "Claimed by", "Unclaimed by", "Renamed by", "Opened by"
//   actionBy    - user/mention who performed the action
//   reason      - (optional) extra line, e.g. a close reason or error
//   color       - accent color as a hex number (e.g. 0xF04747)
//   files       - (optional) attachments, e.g. a close transcript
// =====================================================================
async function logTicketEvent(guild, {
  title,
  ticketChannel,
  category,
  openedBy,
  actionLabel,
  actionBy,
  reason,
  color = 0x8B5CF6,
  files = []
}) {
  if (!config.ticketLogChannel) return;
  const channel = await guild.channels.fetch(config.ticketLogChannel).catch(() => null);
  if (!channel) return;

  const container = new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Channel**\n${ticketChannel}`));

  if (openedBy) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Opened by\n${openedBy}`));
  }
  if (actionLabel && actionBy) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${actionLabel}\n${actionBy}`));
  }
  if (reason) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Reason**\n${reason}`));
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Category**\n${category || "Unknown"}`));

  await channel.send({
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    files
  }).catch(() => {});
}

// Fetches every message in a ticket channel (oldest -> newest) and builds
// a plain-text transcript. Returns { content, filename } so the caller can
// wrap it in as many AttachmentBuilder instances as it needs to send.
async function buildTranscript(channel, reason) {
  const messages = [];
  let before;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (batch.size === 0) break;
    messages.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  messages.reverse(); // oldest first

  const lines = messages.map(m => {
    const time = new Date(m.createdTimestamp).toISOString().replace("T", " ").slice(0, 19);
    let line = `[${time}] ${m.author.tag}: ${m.content || ""}`;
    if (m.attachments.size) {
      line += ` [attachment(s): ${[...m.attachments.values()].map(a => a.url).join(", ")}]`;
    }
    if (m.embeds.length) {
      line += ` [${m.embeds.length} embed(s)]`;
    }
    return line;
  });

  const header = `Transcript for #${channel.name}\nGenerated: ${new Date().toISOString()}\n${reason ? `Close reason: ${reason}\n` : ""}${"=".repeat(60)}\n\n`;
  return { content: header + (lines.join("\n") || "(no messages)"), filename: `transcript-${channel.name}.txt` };
}

module.exports = { tickets, sendTicketPanel, sendBuyAdPanel, logTicketEvent, buildTranscript };
