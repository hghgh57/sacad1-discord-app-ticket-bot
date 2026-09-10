const fs = require("fs");
const path = require("path");
const {
  Client, GatewayIntentBits, Partials, ChannelType, PermissionsBitField,
  ActionRowBuilder, EmbedBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, Collection,
  AttachmentBuilder, ActivityType
} = require("discord.js");
const config = require("./config");
const { isStaff, isBuildStaff } = require("./utils");
const { tickets, sendTicketPanel, logTicketEvent, buildTranscript } = require("./tickets");
const {
  serviceTickets, parseDimensions, calculateDigoutCost, formatPrice,
  sendServiceTicketPanel
} = require("./service-tickets");
const { sendWelcomeMessage } = require("./welcome");
const {
  APPLICATION_TYPES, sessions,
  startApplication, cancelApplication, submitAnswer, sendApplicationPanel
} = require("./applications");
const { recordDeletedMessage, clearSnipe, getSnipe, buildSnipeEmbed } = require("./snipe");
const { handleMessageForSticky } = require("./sticky");
const { setAfk, clearAfk, getAfk } = require("./afk");
const { recordClaim, recordClose } = require("./stats");
const { refreshCard } = require("./statsCards");

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
    const priorityRaw = (i.fields.getTextInputValue("q2") || "").trim().toLowerCase();
    const priority = ["yes", "y", "true"].includes(priorityRaw);

    try {
      const c = await i.guild.channels.create({
        name: `${t}-${i.user.username}`.toLowerCase(),
        type: ChannelType.GuildText,
        parent: v.category,
        topic: i.user.id,
        permissionOverwrites: [
          { id: i.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: i.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: config.staffRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: config.buildTicketRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
        ]
      });

      const emb = new EmbedBuilder().setColor("#8B5CF6").setTitle(`${v.emoji} ${v.label}`)
        .addFields(
          { name: v.questions[0].label, value: ign },
          { name: v.questions[1].label, value: answer1 },
          { name: "Priority", value: priority ? `Yes (+${config.priorityFeePercent}%)` : "No", inline: true }
        )
        .setFooter({ text: "Open Ticket" });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("claim").setLabel("Claim").setEmoji("🤝").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("close").setLabel("Close").setEmoji("🔒").setStyle(ButtonStyle.Danger)
      );

      if (t === "digout") {
        const dims = parseDimensions(answer1);
        if (dims) {
          const { base, final } = calculateDigoutCost(dims, priority);
          emb.addFields(
            { name: "Base price", value: formatPrice(base), inline: false },
            { name: "Total", value: `**${formatPrice(final)}**`, inline: false },
            { name: "Payments", value: "Please note all payments go though IGN : SacService\nNever discuss in DMs" }
          );
        } else {
          emb.addFields({ name: "⚠️ Price", value: "Couldn't auto-calculate a price from those dimensions — a staff member will work it out manually." });
        }
      } else {
        emb.addFields({ name: "Payments", value: "Please note all payments go though IGN : SacService\nNever discuss in DMs" });
      }
      await c.send({ content: `${i.user} <@&${config.buildTicketRole}>`, embeds: [emb], components: [row] });

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

  // ---- Buy Ad ticket button (no dropdown/modal — opens the ticket right away) ----
  if (i.isButton() && i.customId === "buyad_ticket") {
    // Acknowledge immediately — channel creation can take a moment and
    // Discord only allows 3 seconds for the initial response.
    await i.deferReply({ ephemeral: true }).catch(() => {});
    try {
      const c = await i.guild.channels.create({
        name: `ad-${i.user.username}`.toLowerCase(),
        type: ChannelType.GuildText,
        parent: config.buyAd.category,
        topic: i.user.id,
        permissionOverwrites: [
          { id: i.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: i.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: config.staffRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          ...config.buyAd.roles.map(roleId => ({ id: roleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }))
        ]
      });

      const emb = new EmbedBuilder().setColor("#8B5CF6").setTitle("Buy Ad")
        .setDescription(`Ticket opened by ${i.user}`)
        .setFooter({ text: "Open Ticket" });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("claim").setLabel("Claim").setEmoji("🤝").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("close").setLabel("Close").setEmoji("🔒").setStyle(ButtonStyle.Danger)
      );
      await c.send({ content: `${i.user} ${config.buyAd.roles.map(r => `<@&${r}>`).join(" ")}`, embeds: [emb], components: [row] });
      await logTicketEvent(i.guild, `🎫 **Buy Ad** ticket opened by ${i.user} — ${c}`);
      return i.editReply({ content: `Created: ${c}` });
    } catch (err) {
      console.error(`Failed to create buy ad ticket for ${i.user.tag} (${i.user.id}):`, err);
      return i.editReply({
        content: "❌ Couldn't create your ticket — the category ID or role ID in config.js for buyAd is probably missing or invalid, or I'm missing permissions in that category. A server admin should check the bot's logs."
      }).catch(() => {});
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
    } else if (isService ? !isBuildStaff(i.member) : !isStaff(i.member)) {
      return i.reply({ content: "No permission.", ephemeral: true });
    }

    if (i.customId == "claim") {
      if (isService) {
        await i.channel.permissionOverwrites.set([
          { id: i.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: config.staffRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory], deny: [PermissionsBitField.Flags.SendMessages] },
          { id: config.buildTicketRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory], deny: [PermissionsBitField.Flags.SendMessages] },
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
      recordClaim(i.user.id);
      refreshCard(client, i.user.id).catch(() => {});
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
      const overwrites = [
        { id: i.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: config.staffRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        { id: i.channel.topic, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        { id: config.bypassRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
      ];
      if (isService) {
        overwrites.push({ id: config.buildTicketRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
      }
      await i.channel.permissionOverwrites.set(overwrites);
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
    recordClose(i.user.id);
    refreshCard(client, i.user.id).catch(() => {});

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
// ROASTS — used by ,roast @user
// =====================================================================
const ROASTS = [
  "You're the reason shampoo has instructions.",
  "You bring everyone together... to wonder what you're doing.",
  "You're not lazy, you're on energy-saving mode 24/7.",
  "If confidence was skill, you'd still be average.",
  "You're proof autocorrect can't fix everything.",
  "You have two brain cells and they're buffering.",
  "You'd lose a game of hide and seek because nobody would look.",
  "Your Wi-Fi has a stronger connection than your arguments.",
  "You're built like a loading screen.",
  "You make Mondays look exciting.",
  "You're the human version of 1% battery.",
  "If overthinking burned calories, you'd be ripped.",
  "You're about as useful as a chocolate teapot.",
  "You couldn't pour water out of a boot with instructions.",
  "You're always one step behind your own thoughts.",
  "Your luck is so bad, you'd trip over a cordless phone.",
  "You're the CEO of almost.",
  "You'd miss a free giveaway somehow.",
  "You're running on vibes and bad decisions.",
  "You're not a clown—you're the whole circus.",
  "You're the reason the mute button was invented.",
  "Your personality peaked in the tutorial.",
  "You talk a lot for someone who says nothing.",
  "You're built like an unfinished side quest.",
  "If stupidity burned calories, you'd disappear.",
  "You've got the confidence of a billionaire and the IQ of a potato.",
  "Every group chat has a weak link—you volunteered.",
  "You couldn't win an argument with autocorrect.",
  "You're proof that evolution takes breaks.",
  "You make NPCs look self-aware.",
  "You're the final boss of bad takes.",
  "Your barber deserves jail time.",
  "You're the only person who can lose a 1v0.",
  "Your ego writes checks your skills can't cash.",
  "You've got premium confidence on a free trial account.",
  "Your opinions should come with a skip button.",
  "You couldn't carry groceries, let alone a team.",
  "Your aim is so bad the walls feel safe.",
  "You're the human version of lag.",
  "Your best achievement is surviving this long.",
  "You're all keyboard, no gameplay.",
  "You make wrong decisions look consistent.",
  "You're the type to drown in shallow water.",
  "Your common sense is on permanent vacation.",
  "You got ratioed by reality.",
  "Your reflection rolls its eyes at you.",
  "You couldn't find a clue with Google Maps.",
  "You're built like expired DLC.",
  "You make disappointment look athletic.",
  "Even your excuses need better excuses.",
  "You're the reason \"low expectations\" exist.",
  "You're running on borrowed brain cells.",
  "Your chat history should be studied as a warning.",
  "You couldn't organize a two-piece puzzle.",
  "Your voice has negative FPS.",
  "You're allergic to good ideas.",
  "You're the Wi-Fi dead zone of conversations.",
  "Your luck is sponsored by failure.",
  "You make losing look professional.",
  "You're somehow loud and irrelevant.",
  "You couldn't hit water if you fell out of a boat.",
  "Your gameplay is legally considered target practice.",
  "You're the blueprint for bad timing.",
  "You couldn't spell victory if it autocorrected itself.",
  "Your decisions belong in a fail compilation.",
  "You're a plot twist nobody asked for.",
  "You make tutorials look difficult.",
  "You're the type to get lost in a straight hallway.",
  "Your strategy is just panic with confidence.",
  "You're a walking skill issue.",
  "You couldn't roast bread.",
  "Your comebacks arrive next week.",
  "You're built like an apology draft.",
  "You're the before picture in every ad.",
  "Your presence lowers team morale.",
  "You couldn't clutch with unlimited retries.",
  "You're speedrunning embarrassment.",
  "You're the reason spectators laugh.",
  "You've mastered the art of being wrong instantly.",
  "You couldn't lead ducks to a pond.",
  "Your flex is imaginary.",
  "You're the human loading icon.",
  "Your game sense is purely decorative.",
  "You couldn't outsmart a tutorial bot.",
  "You're permanently stuck in silver mindset.",
  "Your confidence has no parental supervision.",
  "You're built like a bug report.",
  "You're an expert at fumbling.",
  "You make friendly fire look intentional.",
  "You couldn't carry a backpack.",
  "Your predictions age like milk.",
  "You're the lag spike in everyone's day.",
  "Your brain files are corrupted.",
  "You couldn't finish a sentence without derailing it.",
  "Your highlight reel is buffering.",
  "You're the type to miss point-blank.",
  "Your teamwork is a horror genre.",
  "You're built like recycled excuses.",
  "You're the captain of bad decisions.",
  "Your logic needs customer support.",
  "You're somehow AFK while talking.",
  "You couldn't cook instant noodles.",
  "You're a participation trophy with Wi-Fi.",
  "Your memory resets every argument.",
  "You're the reason \"try again\" exists.",
  "Your luck owes you a refund.",
  "You're an unpaid actor in everyone else's story.",
  "You couldn't outplay a loading screen.",
  "You're the discount version of average.",
  "Your confidence is louder than your results.",
  "You couldn't catch a cold in winter.",
  "You're the typo in the group project.",
  "Your ideas arrive already outdated.",
  "You're built like an internet outage.",
  "You couldn't even gaslight Google.",
  "You're the side character who thinks he's the main event.",
  "Your talent is making simple things complicated.",
  "You're one update away from functioning.",
  "You're the reason \"skill gap\" is a phrase.",
  "You're living proof that talking and knowing aren't the same thing."
];

// userId -> timestamp (ms) they last successfully used ,roast
const roastCooldowns = new Map();
const ROAST_COOLDOWN_MS = 10_000;

// =====================================================================
// AFK — clears the sender's AFK on any activity, and lets people know
// when they @mention someone who's currently AFK
// =====================================================================
client.on("messageCreate", message => {
  if (message.author.bot) return;
  if (!message.guild) return;

  // Sending any message (other than setting AFK again) clears your own AFK.
  if (!message.content.toLowerCase().startsWith(",afk")) {
    if (getAfk(message.author.id)) {
      clearAfk(message.author.id);
      message.reply({ content: `👋 Welcome back ${message.author}, I removed your AFK status.` }).catch(() => {});
    }
  }

  // Let the sender know if anyone they just mentioned is AFK.
  // Sent as an embed (not plain content) so the AFK user isn't pinged a second time.
  const mentioned = message.mentions.users.filter(u => !u.bot && u.id !== message.author.id);
  if (mentioned.size) {
    const lines = [];
    for (const user of mentioned.values()) {
      const afk = getAfk(user.id);
      if (afk) lines.push(`**${user.tag}** is AFK: ${afk.reason}`);
    }
    if (lines.length) {
      const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setDescription(`💤 ${lines.join("\n")}`);
      message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } }).catch(() => {});
    }
  }
});

// =====================================================================
// GUILD TEXT COMMANDS (,s / ,cs / ,roast / ,afk)
// =====================================================================
client.on("messageCreate", async message => {
  if (message.author.bot) return;
  if (!message.guild) return; // guild-only commands
  if (!message.content.startsWith(",")) return;

  if (message.content.toLowerCase().startsWith(",afk")) {
    const reason = message.content.slice(",afk".length).trim() || "AFK";
    setAfk(message.author.id, reason);
    return message.reply({ content: `😴 You're now AFK: ${reason}` });
  }

  const [cmd] = message.content.slice(1).trim().split(/\s+/);

  if (cmd === "s") {
    if (!isStaff(message.member)) return message.reply({ content: "No permission." });
    const snipe = getSnipe(message.channelId);
    if (!snipe) return message.reply({ content: "There's nothing to snipe in this channel." });
    return message.channel.send({ embeds: [buildSnipeEmbed(snipe)] });
  }

  if (cmd === "cs") {
    if (!isStaff(message.member)) return message.reply({ content: "No permission." });
    const cleared = clearSnipe(message.channelId);
    return message.reply({ content: cleared ? "🧹 Snipe cleared for this channel." : "There was nothing to clear." });
  }

  if (cmd === "roast") {
    const target = message.mentions.users.first();
    if (!target) return message.reply({ content: "Mention someone to roast! Usage: `,roast @user`" });

    const now = Date.now();
    const lastUsed = roastCooldowns.get(message.author.id);
    if (lastUsed && now - lastUsed < ROAST_COOLDOWN_MS) {
      const remaining = Math.ceil((ROAST_COOLDOWN_MS - (now - lastUsed)) / 1000);
      return message.reply({ content: `Woah, slow down — wait another ${remaining}s.` });
    }
    roastCooldowns.set(message.author.id, now);

    const roast = ROASTS[Math.floor(Math.random() * ROASTS.length)];
    return message.channel.send({ content: `${target} ${roast}` });
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
