const fs = require("fs");
const path = require("path");
const {
  Client, GatewayIntentBits, Partials, ChannelType, PermissionsBitField,
  ActionRowBuilder, EmbedBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, Collection
} = require("discord.js");
const config = require("./config");
const { isStaff } = require("./utils");
const { tickets, sendTicketPanel, logTicketEvent } = require("./tickets");
const {
  APPLICATION_TYPES, sessions,
  startApplication, cancelApplication, submitAnswer, sendApplicationPanel
} = require("./applications");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
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
    const c = await i.guild.channels.create({
      name: `${t}-${i.user.username}`.toLowerCase(),
      type: ChannelType.GuildText,
      parent: config.categories[t],
      topic: i.user.id,
      permissionOverwrites: [
        { id: i.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: i.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        { id: config.bypassRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
      ]
    });
    const emb = new EmbedBuilder().setColor("#8B5CF6").setTitle(`${v.emoji} ${v.label}`)
      .addFields(v.questions.map((q, n) => ({ name: q.label, value: i.fields.getTextInputValue("q" + n) || "N/A" })))
      .setFooter({ text: "Open Ticket" });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("claim").setLabel("Claim").setEmoji("🤝").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("close").setLabel("Close").setEmoji("🔒").setStyle(ButtonStyle.Danger)
    );
    await c.send({ content: `${i.user}`, embeds: [emb], components: [row] });
    await logTicketEvent(i.guild, `🎫 **${v.label}** ticket opened by ${i.user} — ${c}`);
    return i.reply({ content: `Created: ${c}`, ephemeral: true });
  }

  // ---- Ticket claim/close buttons ----
  if (i.isButton() && (i.customId === "claim" || i.customId === "close")) {
    if (!isStaff(i.member)) return i.reply({ content: "No permission.", ephemeral: true });

    if (i.customId == "claim") {
      await i.channel.permissionOverwrites.set([
        { id: i.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: i.channel.topic, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        { id: i.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        { id: config.bypassRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
      ]);
      const e = EmbedBuilder.from(i.message.embeds[0]).setFooter({ text: `Claimed by ${i.user.tag}` });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("claim").setLabel("Claimed").setEmoji("✅").setStyle(ButtonStyle.Success).setDisabled(true),
        new ButtonBuilder().setCustomId("close").setLabel("Close").setEmoji("🔒").setStyle(ButtonStyle.Danger)
      );
      await i.update({ embeds: [e], components: [row] });
      await logTicketEvent(i.guild, `🤝 Ticket **#${i.channel.name}** claimed by ${i.user}`);
      return i.followUp({ content: `Claimed by ${i.user}`, ephemeral: false });
    }
    if (i.customId == "close") {
      await i.reply({ content: "Closing in 3 seconds..." });
      await logTicketEvent(i.guild, `🔒 Ticket **#${i.channel.name}** closed by ${i.user}`);
      setTimeout(() => i.channel.delete().catch(() => {}), 3000);
    }
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

  // ---- Application: Accept / Deny (in the review channel) ----
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
      const applicant = await client.users.fetch(applicantId).catch(() => null);
      if (applicant) {
        await applicant.send({
          embeds: [new EmbedBuilder().setColor("#43B581").setTitle(`✅ ${info.label} Accepted`).setDescription(`Congratulations! Your ${info.label.toLowerCase()} has been **accepted** by ${i.user.tag}.`)]
        }).catch(() => {});
      }
      return;
    }

    // Deny -> ask for a reason via modal
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
