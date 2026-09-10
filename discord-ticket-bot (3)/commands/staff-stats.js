const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getStaffStats, getSponsorTotal } = require("../stats");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("staff-stats")
    .setDescription("Check someone's claims, closes, and total sponsored")
    .addUserOption(o => o.setName("user").setDescription("Defaults to yourself").setRequired(false)),

  async execute(interaction) {
    const target = interaction.options.getUser("user") || interaction.user;
    const { claims, closes } = getStaffStats(target.id);
    const sponsored = getSponsorTotal(target.id);

    const embed = new EmbedBuilder()
      .setColor("#8B5CF6")
      .setTitle(`📊 Stats for ${target.tag}`)
      .setThumbnail(target.displayAvatarURL())
      .addFields(
        { name: "Claims", value: `${claims}`, inline: true },
        { name: "Closes", value: `${closes}`, inline: true },
        { name: "Total Sponsored", value: `$${sponsored.toLocaleString()}`, inline: true }
      );

    return interaction.reply({ embeds: [embed] });
  }
};
