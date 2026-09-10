const { SlashCommandBuilder } = require("discord.js");
const { isBuildStaff } = require("../utils");
const config = require("../config");
const { recordTrackerEvent } = require("../tracker");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ticket-rename")
    .setDescription("Rename the current ticket channel")
    .addStringOption(o => o.setName("name").setDescription("New name for this ticket").setRequired(true)),

  async execute(interaction) {
    if (!isBuildStaff(interaction.member)) {
      return interaction.reply({ content: "No permission.", ephemeral: true });
    }

    const inTicketCategory = interaction.channel.parentId && (
      Object.values(config.categories).includes(interaction.channel.parentId)
      || Object.values(config.serviceCategories).includes(interaction.channel.parentId)
    );
    // Category alone isn't enough — another ticket bot's channels could sit in
    // the same category. Every ticket THIS bot creates sets the channel topic
    // to the opener's user ID (a numeric snowflake), so require that too.
    const isOurTicket = inTicketCategory && /^\d{15,25}$/.test(interaction.channel.topic || "");
    if (!isOurTicket) {
      return interaction.reply({ content: "This isn't a ticket channel.", ephemeral: true });
    }

    const newName = interaction.options.getString("name")
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-_]/g, "")
      .slice(0, 90) || "ticket";

    await interaction.channel.setName(newName, `Renamed by ${interaction.user.tag}`);
    recordTrackerEvent(interaction.client, interaction.guild.id, interaction.user.id, "renames").catch(() => {});
    return interaction.reply({ content: `✅ Renamed this ticket to **${newName}**.` });
  }
};
