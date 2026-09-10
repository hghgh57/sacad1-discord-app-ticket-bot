const { SlashCommandBuilder } = require("discord.js");
const { buildLeaderboardEmbed, buildLeaderboardMenu } = require("../stats");

// Public leaderboard — anyone can use it, no staff check. Starts on the
// Claims leaderboard; the dropdown (handled in index.js) switches it to
// Closes / Renames in place.
module.exports = {
  data: new SlashCommandBuilder()
    .setName("ticket-leaderboard")
    .setDescription("Show the ticket leaderboard (claims, closes, or renames)"),

  async execute(interaction) {
    const embed = await buildLeaderboardEmbed(interaction.client, "claims");
    return interaction.reply({ embeds: [embed], components: [buildLeaderboardMenu("claims")] });
  }
};
