const { SlashCommandBuilder } = require("discord.js");
const { isStaff } = require("../utils");
const { setSticky } = require("../sticky");

function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("sticky")
    .setDescription("Stick a message to the bottom of this channel")
    .addStringOption(o =>
      o.setName("message")
        .setDescription("The message to stick")
        .setRequired(true))
    .addBooleanOption(o =>
      o.setName("plaintext")
        .setDescription("Send as plain text instead of an embed (default: false)")
        .setRequired(false))
    .addStringOption(o =>
      o.setName("gif_url")
        .setDescription("Link to a GIF to show in the sticky")
        .setRequired(false))
    .addAttachmentOption(o =>
      o.setName("gif_file")
        .setDescription("Upload a GIF to show in the sticky")
        .setRequired(false)),

  async execute(interaction) {
    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: "No permission.", ephemeral: true });
    }

    const content = interaction.options.getString("message");
    const plaintext = interaction.options.getBoolean("plaintext") ?? false;
    const gifUrlInput = interaction.options.getString("gif_url");
    const gifAttachment = interaction.options.getAttachment("gif_file");
    const gifUrl = gifAttachment?.url || gifUrlInput || null;

    if (gifUrlInput && !gifAttachment && !isValidUrl(gifUrlInput)) {
      return interaction.reply({ content: "⚠️ That doesn't look like a valid GIF URL.", ephemeral: true });
    }

    try {
      await setSticky(interaction.channel, content, { gifUrl, plaintext });
    } catch (err) {
      console.error("Failed to set sticky:", err);
      return interaction.reply({ content: "⚠️ Couldn't set the sticky message. Check my permissions in this channel.", ephemeral: true });
    }

    return interaction.reply({ content: "📌 Sticky message set for this channel.", ephemeral: true });
  }
};
