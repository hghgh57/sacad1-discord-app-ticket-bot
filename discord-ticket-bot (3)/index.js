const fs = require("fs");
const path = require("path");
const {
  Client, GatewayIntentBits, Partials, ChannelType, PermissionsBitField,
  ActionRowBuilder, EmbedBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, Collection,
  AttachmentBuilder, ActivityType
} = require("discord.js");
const config = require("./config");
const { isStaff } = require("./utils");
const { tickets, sendTicketPanel, logTicketEvent, buildTranscript } = require("./tickets");
const {
  serviceTickets, parseDimensions, calculateDigoutCost, formatPrice,
  sendServiceTicketPanel, buildPriorityRow
} = require("./service-tickets");
const { sendWelcomeMessage } = require("./welcome");
const {
  APPLICATION_TYPES, sessions,
  startApplication, cancelApplication, submitAnswer, sendApplicationPanel
} = require("./applications");
const { recordDeletedMessage, clearSnipe, getSnipe, buildSnipeEmbed } = require("./snipe");
const { handleMessageForSticky } = require("./sticky");

// channelId -> { l, w, h, ign } — dimensions waiting on a priority answer
const pendingDigouts = new Map();

// channelId -> claimer's user id, for service tickets only (digout/base building).
// Used to lock the claim/close buttons + typing down to the claimer, the
// ticket owner, and the bypass role once a service ticket has been claimed.
const ticketClaims = new Map();

function isServiceChannel(channel) {
  return Object.values(config.serviceCategories).includes(channel.parentId);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

// =====================================================================
// COMMAND LOADER
// Drop a new file in ./commands (exporting { data, execute }) and it's
// picked up automatically — no need to touch this file. Remember to run
// `node deploy-commands.js` afterwards so Discord knows about it.
// =====================================================================
client.commands = new Collection();

const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith(".js"));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (!command?.data || !command?.execute) {
    console.warn(`⚠️  Skipping ${file} — missing "data" or "execute" export.`);
    continue;
  }
  client.commands.set(command.data.name, command);
}

// =====================================================================
// READY
// =====================================================================
client.once("ready", () => {
  console.log(`Ready — loaded ${client.commands.size} command(s): ${[...client.commands.keys()].join(", ")}`);
  console.log("Note: slash commands are registered via `node deploy-commands.js`, not on startup.");
  client.user.setActivity("discord.gg/sacad1", { type: ActivityType.Watching });
});

// =====================================================================
// INTERACTIONS
// =====================================================================
client.on("interactionCreate", async i => {
  // ---- Slash commands ----
  if (i.isChatInputCommand()) {
    const command = client.commands.get(i.commandName);
    if (!command) return;
    try {
      await command.execute(i);
    } catch (err) {
      console.error(`Error running /${i.commandName}:`, err);
      const payload = { content: "❌ Something went wrong running that command.", ephemeral: true };
      if (i.replied || i.deferred) await i.followUp(payload).catch(() => {});
      else await i.reply(payload).catch(() => {});
    }
    return;
  }

  // ---- Ticket select menu ----
  if (i.isStringSelectMenu() && i.customId === "ticket") {
    const t = i.values[0], v = tickets[t];
    const modal = new ModalBuilder().setCustomId("m_" + t).setTitle(v.label);
    v.questions.forEach((q, n) => {
      const input = new TextInputBuilder().setCustomId("q" + n).setLabel(q.label).setStyle(q.style).setRequired(true);
      if (q.placeholder) input.setPlaceholder(q.placeholder);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
    });
    await i.showModal(modal);
    // Re-send the panel's own components so the dropdown's selection
    // highlight clears — otherwise Discord shows a checkmark on the last
    // picked option and won't let you pick it again until it refreshes.
    await i.message.edit({ components: i.message.components }).catch(() => {});
    return;
  }

  // ---- Service ticket select menu (Digout / Base Building) ----
  if (i.isStringSelectMenu() && i.customId === "service_ticket") {
    const t = i.values[0], v = serviceTickets[t];
    const modal = new ModalBuilder().setCustomId("svcm_" + t).setTitle(v.label);
    v.questions.forEach((q, n) => {
      const input = new TextInputBuilder().setCustomId("q" + n).setLabel(q.label).setStyle(q.style).setRequired(true);
      if (q.placeholder) input.setPlaceholder(q.placeholder);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
    });
    await i.showModal(modal);
    await i.message.edit({ components: i.message.components }).catch(() => {});
    return;
  }

  // ---- Service ticket modal submit (Digout / Base Building) ----
  if (i.isModalSubmit() && i.customId.startsWith("svcm_")) {
    const t = i.customId.slice("svcm_".length), v = serviceTickets[t];
    const ign = i.fields.getTextInputValue("q0") || "N/A";
    const answer1 = i.fields.getTextInputValue("q1") || "N/A";

    try {
      const c = await i.guild.channels.create({
        name: `${t}-${i.user.username}`.toLowerCase(),
        type: ChannelType.GuildText,
        parent: v.category,
        topic: i.user.id,
        permissionOverwrites: [
          { id: i.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: i.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: config.staffRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
        ]
      });

      const emb = new EmbedBuilder().setColor("#8B5CF6").setTitle(`${v.emoji} ${v.label}`)
        .addFields(
          { name: v.questions[0].label, value: ign },
          { name: v.questions[1].label, value: answer1 }
        )
        .setFooter({ text: "Open Ticket" });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("claim").setLabel("Claim").setEmoji("🤝").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("close").setLabel("Close").setEmoji("🔒").setStyle(ButtonStyle.Danger)
      );

      if (t === "digout") {
        const dims = parseDimensions(answer1);
        if (dims) {
          pendingDigouts.set(c.id, { ...dims, ign });
          await c.send({ content: `${i.user} <@&${config.staffRole}>`, embeds: [emb], components: [row] });
          await c.send({
            content: "One more thing — would you like rush priority?",
            components: [buildPriorityRow()]
          });
        } else {
          emb.addFields({ name: "⚠️ Price", value: "Couldn't auto-calculate a price from those dimensions — a staff member will work it out manually." });
          await c.send({ content: `${i.user} <@&${config.staffRole}>`, embeds: [emb], components: [row] });
        }
      } else {
        await c.send({ content: `${i.user} <@&${config.staffRole}>`, embeds: [emb], components: [row] });
      }

      await logTicketEvent(i.guild, `🎫 **${v.label}** ticket opened by ${i.user} — ${c}`);
      return i.reply({ content: `Created: ${c}`, ephemeral: true });
    } catch (err) {
      console.error(`Failed to create "${t}" service ticket for ${i.user.tag} (${i.user.id}):`, err);
      return i.reply({
        content: "❌ Couldn't create your ticket — the category ID for this ticket type is probably missing or invalid in config.js. A server admin should check the bot's logs.",
        ephemeral: true
      });
    }
  }

  // ---- Digout priority dropdown answer ----
  if (i.isStringSelectMenu() && i.customId === "digout_priority") {
    const pending = pendingDigouts.get(i.channelId);
    if (!pending) {
      return i.update({ content: "This has already been answered or the ticket data expired.", components: [] });
    }
    const priority = i.values[0] === "yes";
    const { base, final } = calculateDigoutCost(pending, priority);
    pendingDigouts.delete(i.channelId);

    const embed = new EmbedBuilder()
      .setColor("#8B5CF6")
      .setTitle("💰 Price")
      .addFields(
        { name: "Dimensions", value: `${pending.l} x ${pending.w} x ${pending.h}`, inline: true },
        { name: "Priority", value: priority ? `Yes (+${config.priorityFeePercent}%)` : "No", inline: true },
        { name: "Base price", value: formatPrice(base), inline: false },
        { name: "Total", value: `**${formatPrice(final)}**`, inline: false },
        { name: "Payments", value: "Please note all payments go though IGN : SacService\nNever discuss in DMs" }
      );

    return i.update({ content: null, embeds: [embed], components: [] });
  }

  // ---- Application type select menu ----
  if (i.isStringSelectMenu() && i.customId === "apply_type") {
    const type = i.values[0];
    if (sessions.has(i.user.id)) {
      return i.reply({ content: "You already have an application in progress in your DMs.", ephemeral: true });
    }
    const info = APPLICATION_TYPES[type];
    const embed = new EmbedBuilder()
      .setColor("#8B5CF6")
      .setTitle("Are you sure you want to apply?")
      .setDescription(
        `**${info.label}**\n\n` +
        "Once you start the application I will send you a series of questions. " +
        "You will have 3 hours to complete the application. If you do not complete the application in time, you will have to restart. " +
        "If you wish to stop the application feel free to click the cancel button at any time."
      );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`app_start_${type}`).setLabel("Start Application").setEmoji("✅").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("app_cancel").setLabel("Cancel Application").setEmoji("🛑").setStyle(ButtonStyle.Danger)
    );
    try {
      await i.user.send({ embeds: [embed], components: [row] });
      return i.reply({ content: "📩 Check your DMs!", ephemeral: true });
    } catch {
      return i.reply({ content: "❌ I couldn't DM you. Please enable DMs from server members and try again.", ephemeral: true });
    }
  }

  // ---- Application ticket modal submit ----
  if (i.isModalSubmit() && i.customId.startsWith("m_")) {
    const t = i.customId.slice(2), v = tickets[t];
    try {
      const c = await i.guild.channels.create({
        name: `${t}-${i.user.username}`.toLowerCase(),
        type: ChannelType.GuildText,
        parent: config.categories[t],
        topic: i.user.id,
        permissionOverwrites: [
          { id: i.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: i.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: config.staffRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
        ]
      });
      const emb = new EmbedBuilder().setColor("#8B5CF6").setTitle(`${v.emoji} ${v.label}`)
        .addFields(v.questions.map((q, n) => ({ name: q.label, value: i.fields.getTextInputValue("q" + n) || "N/A" })))
        .setFooter({ text: "Open Ticket" });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("claim").setLabel("Claim").setEmoji("🤝").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("close").setLabel("Close").setEmoji("🔒").setStyle(ButtonStyle.Danger)
      );
      await c.send({ content: `${i.user} <@&${config.staffRole}>`, embeds: [emb], components: [row] });
      await logTicketEvent(i.guild, `🎫 **${v.label}** ticket opened by ${i.user} — ${c}`);
      return i.reply({ content: `Created: ${c}`, ephemeral: true });
    } catch (err) {
      console.error(`Failed to create "${t}" ticket for ${i.user.tag} (${i.user.id}):`, err);
      return i.reply({
        content: "❌ Couldn't create your ticket — the category ID or role ID in config.js for this ticket type is probably missing or invalid. A server admin should check the bot's logs.",
        ephemeral: true
      });
    }
  }

  // ---- Ticket claim/close/unclaim buttons ----
  if (i.isButton() && (i.customId === "claim" || i.customId === "close" || i.customId === "unclaim")) {
    const isService = isServiceChannel(i.channel);
    const claimerId = ticketClaims.get(i.channelId);
    const openerId = i.channel.topic;
    const hasBypass = i.member.permissions.has(PermissionsBitField.Flags.Administrator) || i.member.roles.cache.has(config.bypassRole);

    if (i.customId === "unclaim") {
      // Only the claimer or bypass role can give up a claim (not the opener).
      const allowed = hasBypass || i.user.id === claimerId;
      if (!allowed) return i.reply({ content: "Only the claimer or bypass role can unclaim this.", ephemeral: true });
    } else if (isService && claimerId) {
      // Already claimed — locked down to the claimer, the ticket owner, or bypass role only.
      const allowed = hasBypass || i.user.id === claimerId || i.user.id === openerId;
      if (!allowed) {
        return i.reply({ content: "This ticket has been claimed — only the claimer, the ticket owner, or bypass role can do that now.", ephemeral: true });
      }
    } else if (!isStaff(i.member)) {
      return i.reply({ content: "No permission.", ephemeral: true });
    }

    if (i.customId == "claim") {
      if (isService) {
        await i.channel.permissionOverwrites.set([
          { id: i.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: config.staffRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory], deny: [PermissionsBitField.Flags.SendMessages] },
          { id: i.channel.topic, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: i.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: config.bypassRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
        ]);
      } else {
        await i.channel.permissionOverwrites.set([
          { id: i.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: i.channel.topic, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: i.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: config.bypassRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
        ]);
      }
      ticketClaims.set(i.channelId, i.user.id);
      const e = EmbedBuilder.from(i.message.embeds[0]).setFooter({ text: `Claimed by ${i.user.tag}` });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("unclaim").setLabel("Unclaim").setEmoji("🔓").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("close").setLabel("Close").setEmoji("🔒").setStyle(ButtonStyle.Danger)
      );
      await i.update({ embeds: [e], components: [row] });
      await logTicketEvent(i.guild, `🤝 Ticket **#${i.channel.name}** claimed by ${i.user}`);
      return i.followUp({ content: `Claimed by ${i.user}`, ephemeral: false });
    }
    if (i.customId == "unclaim") {
      await i.channel.permissionOverwrites.set([
        { id: i.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: config.staffRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        { id: i.channel.topic, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        { id: config.bypassRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
      ]);
      ticketClaims.delete(i.channelId);
      const e = EmbedBuilder.from(i.message.embeds[0]).setFooter({ text: "Open Ticket" });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("claim").setLabel("Claim").setEmoji("🤝").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("close").setLabel("Close").setEmoji("🔒").setStyle(ButtonStyle.Danger)
      );
      await i.update({ embeds: [e], components: [row] });
      await logTicketEvent(i.guild, `🔓 Ticket **#${i.channel.name}** unclaimed by ${i.user}`);
      return i.followUp({ content: `Unclaimed by ${i.user}`, ephemeral: false });
    }
    if (i.customId == "close") {
      // Ask for an optional reason before actually closing.
      const modal = new ModalBuilder().setCustomId("close_reason").setTitle("Close Ticket");
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Reason (optional)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setPlaceholder("Why is this ticket being closed?")
      ));
      return i.showModal(modal);
    }
    return;
  }

  // ---- Close ticket modal submit ----
  if (i.isModalSubmit() && i.customId === "close_reason") {
    const reason = i.fields.getTextInputValue("reason")?.trim();
    await i.reply({ content: "Closing in 3 seconds..." });

    const channel = i.channel;
    const openerId = channel.topic;
    ticketClaims.delete(channel.id);

    try {
      const { content, filename } = await buildTranscript(channel, reason);

      // DM the transcript to whoever opened the ticket
      const opener = await client.users.fetch(openerId).catch(() => null);
      if (opener) {
        await opener.send({
          content: `📄 Here's the transcript for your ticket **#${channel.name}**.`,
          files: [new AttachmentBuilder(Buffer.from(content, "utf-8"), { name: filename })]
        }).catch(() => {});
      }

      // Post the transcript in the ticket log channel
      await logTicketEvent(
        i.guild,
        `🔒 Ticket **#${channel.name}** closed by ${i.user}${reason ? `\n**Reason:** ${reason}` : ""}`,
        "#F04747",
        [new AttachmentBuilder(Buffer.from(content, "utf-8"), { name: filename })]
      );
    } catch (err) {
      console.error(`Failed to build/send transcript for #${channel.name}:`, err);
      await logTicketEvent(i.guild, `🔒 Ticket **#${channel.name}** closed by ${i.user}${reason ? `\n**Reason:** ${reason}` : ""} (⚠️ transcript failed — check logs)`, "#F04747");
    }

    setTimeout(() => channel.delete().catch(() => {}), 3000);
    return;
  }

  // ---- Application: Start button ----
  if (i.isButton() && i.customId.startsWith("app_start_")) {
    const type = i.customId.slice("app_start_".length);
    if (!APPLICATION_TYPES[type]) return;
    if (sessions.has(i.user.id)) return i.reply({ content: "You already have an application in progress.", ephemeral: true });
    await i.update({ content: "✅ Application started! Answer each question below.", embeds: [], components: [] });
    return startApplication(i.user, type);
  }

  // ---- Application: Cancel button (works before or during an application) ----
  if (i.isButton() && i.customId === "app_cancel") {
    await i.update({ components: [] }).catch(() => {});
    return cancelApplication(i.user);
  }

  // ---- Application: dropdown answers ----
  if (i.isStringSelectMenu() && i.customId === "app_select") {
    const session = sessions.get(i.user.id);
    if (!session || session.awaiting !== "select") return i.reply({ content: "This application isn't active anymore.", ephemeral: true });
    const value = i.values[0];
    await i.update({ content: `Answer recorded: **${value}**`, embeds: [], components: [] });
    return submitAnswer(i.user, session, value);
  }

  // ---- Application: Quick Deny (no reason) ----
  if (i.isButton() && i.customId.startsWith("app_denyquick_")) {
    if (!isStaff(i.member)) return i.reply({ content: "No permission.", ephemeral: true });

    const rest = i.customId.slice("app_denyquick_".length);
    const firstUnderscore = rest.indexOf("_");
    const type = rest.slice(0, firstUnderscore);
    const applicantId = rest.slice(firstUnderscore + 1);
    const info = APPLICATION_TYPES[type];

    const embed = EmbedBuilder.from(i.message.embeds[0]).setColor("#F04747").addFields({ name: "Status", value: `❌ Denied by ${i.user.tag}` });
    await i.update({ embeds: [embed, ...i.message.embeds.slice(1)], components: [] });

    const applicant = await client.users.fetch(applicantId).catch(() => null);
    if (applicant) {
      await applicant.send({
        embeds: [new EmbedBuilder().setColor("#F04747").setTitle(`❌ ${info.label} Denied`).setDescription(`Your ${info.label.toLowerCase()} has been **denied** by ${i.user.tag}.`)]
      }).catch(() => {});
    }
    return;
  }

  // ---- Application: Accept / Deny w/ Reason (in the review channel) ----
  if (i.isButton() && (i.customId.startsWith("app_accept_") || i.customId.startsWith("app_deny_"))) {
    if (!isStaff(i.member)) return i.reply({ content: "No permission.", ephemeral: true });

    const isAccept = i.customId.startsWith("app_accept_");
    const rest = i.customId.slice(isAccept ? "app_accept_".length : "app_deny_".length);
    const firstUnderscore = rest.indexOf("_");
    const type = rest.slice(0, firstUnderscore);
    const applicantId = rest.slice(firstUnderscore + 1);
    const info = APPLICATION_TYPES[type];

    if (isAccept) {
      const embed = EmbedBuilder.from(i.message.embeds[0]).setColor("#43B581").addFields({ name: "Status", value: `✅ Accepted by ${i.user.tag}` });
      await i.update({ embeds: [embed, ...i.message.embeds.slice(1)], components: [] });

      const roleId = config.approvedRoles[type];
      if (roleId) {
        const member = await i.guild.members.fetch(applicantId).catch(() => null);
        if (member) await member.roles.add(roleId).catch(err => console.error(`Failed to add approved role to ${applicantId}:`, err));
      }

      const applicant = await client.users.fetch(applicantId).catch(() => null);
      if (applicant) {
        await applicant.send({
          embeds: [new EmbedBuilder().setColor("#43B581").setTitle(`✅ ${info.label} Accepted`).setDescription(`Congratulations! Your ${info.label.toLowerCase()} has been **accepted** by ${i.user.tag}.`)]
        }).catch(() => {});
      }
      return;
    }

    // Deny w/ Reason -> ask for a reason via modal
    const modal = new ModalBuilder().setCustomId(`app_deny_reason_${type}_${applicantId}`).setTitle("Deny Application");
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("reason").setLabel("Reason for denial").setStyle(TextInputStyle.Paragraph).setRequired(true)
    ));
    return i.showModal(modal);
  }

  // ---- Deny reason modal submit ----
  if (i.isModalSubmit() && i.customId.startsWith("app_deny_reason_")) {
    const rest = i.customId.slice("app_deny_reason_".length);
    const firstUnderscore = rest.indexOf("_");
    const type = rest.slice(0, firstUnderscore);
    const applicantId = rest.slice(firstUnderscore + 1);
    const info = APPLICATION_TYPES[type];
    const reason = i.fields.getTextInputValue("reason");

    const embed = EmbedBuilder.from(i.message.embeds[0]).setColor("#F04747").addFields(
      { name: "Status", value: `❌ Denied by ${i.user.tag}` },
      { name: "Reason", value: reason }
    );
    await i.update({ embeds: [embed, ...i.message.embeds.slice(1)], components: [] });

    const applicant = await client.users.fetch(applicantId).catch(() => null);
    if (applicant) {
      await applicant.send({
        embeds: [new EmbedBuilder().setColor("#F04747").setTitle(`❌ ${info.label} Denied`).setDescription(`Your ${info.label.toLowerCase()} has been **denied** by ${i.user.tag}.`).addFields({ name: "Reason", value: reason })]
      }).catch(() => {});
    }
    return;
  }
});

// =====================================================================
// NEW MEMBER WELCOME
// =====================================================================
client.on("guildMemberAdd", member => {
  sendWelcomeMessage(member).catch(err => console.error("Failed to send welcome message:", err));
});

// =====================================================================
// SNIPE — remember the last deleted message per channel
// =====================================================================
client.on("messageDelete", message => {
  recordDeletedMessage(message);
});

// =====================================================================
// STICKY MESSAGES — repost the sticky to the bottom of the channel
// whenever someone else sends a message
// =====================================================================
client.on("messageCreate", message => {
  if (message.author.bot) return;
  if (!message.guild) return;
  handleMessageForSticky(message).catch(err => console.error("Sticky repost failed:", err));
});

// =====================================================================
// GUILD TEXT COMMANDS (,s / ,cs)
// =====================================================================
client.on("messageCreate", async message => {
  if (message.author.bot) return;
  if (!message.guild) return; // guild-only commands
  if (!message.content.startsWith(",")) return;

  const [cmd] = message.content.slice(1).trim().split(/\s+/);

  if (cmd === "s") {
    const snipe = getSnipe(message.channelId);
    if (!snipe) return message.reply({ content: "There's nothing to snipe in this channel." });
    return message.channel.send({ embeds: [buildSnipeEmbed(snipe)] });
  }

  if (cmd === "cs") {
    if (!isStaff(message.member)) return message.reply({ content: "No permission." });
    const cleared = clearSnipe(message.channelId);
    return message.reply({ content: cleared ? "🧹 Snipe cleared for this channel." : "There was nothing to clear." });
  }
});

// =====================================================================
// DM MESSAGES (text / image answers for active applications)
// =====================================================================
client.on("messageCreate", async message => {
  if (message.author.bot) return;
  if (message.guild) return; // DMs only

  const session = sessions.get(message.author.id);
  if (!session) return;

  const q = session.questions[session.index];

  if (session.awaiting === "text") {
    if (!message.content.trim()) return message.reply("Please send a text answer.");
    return submitAnswer(message.author, session, message.content.trim());
  }

  if (session.awaiting === "images") {
    const images = [...message.attachments.values()].filter(a => (a.contentType || "").startsWith("image/")).map(a => a.url);
    if (images.length < q.min || images.length > q.max) {
      return message.reply(`Please upload between ${q.min} and ${q.max} images in a single message.`);
    }
    return submitAnswer(message.author, session, images);
  }

  if (session.awaiting === "images_or_text") {
    const images = [...message.attachments.values()].filter(a => (a.contentType || "").startsWith("image/")).map(a => a.url);
    if (images.length) {
      if (images.length > q.max) return message.reply(`Please upload up to ${q.max} images.`);
      return submitAnswer(message.author, session, images);
    }
    if (!message.content.trim()) return message.reply("Please send a text answer, or upload images.");
    return submitAnswer(message.author, session, message.content.trim());
  }
  // if session.awaiting === "select", ignore plain messages — they must use the dropdown
});

client.login(config.token);
