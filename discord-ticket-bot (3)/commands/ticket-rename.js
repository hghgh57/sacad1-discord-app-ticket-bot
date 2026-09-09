const { SlashCommandBuilder } = require("discord.js");
const { isStaff } = require("../utils");
const config = require("../config");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ticket-rename")
    .setDescription("Rename the current ticket channel")
    .addStringOption(o => o.setName("name").setDescription("New name for this ticket").setRequired(true)),

  async execute(interaction) {
    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: "No permission.", ephemeral: true });
    }

    const isTicketChannel = interaction.channel.parentId && Object.values(config.categories).includes(interaction.channel.parentId);
    if (!isTicketChannel) {
      return interaction.reply({ content: "This isn't a ticket channel.", ephemeral: true });
    }

    const newName = interaction.options.getString("name")
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-_]/g, "")
      .slice(0, 90) || "ticket";

    await interaction.channel.setName(newName, `Renamed by ${interaction.user.tag}`);
    return interaction.reply({ content: `✅ Renamed this ticket to **${newName}**.` });
  }
};
