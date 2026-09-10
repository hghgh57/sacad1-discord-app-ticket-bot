const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const { isStaff } = require("../utils");
const config = require("../config");
const { resetUser, resetAll } = require("../stats");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("staff-reset")
    .setDescription("Reset tracked stats (claims/closes/sponsored)")
    .addSubcommand(sub => sub
      .setName("user")
      .setDescription("Reset one user's stats")
      .addUserOption(o => o.setName("user").setDescription("Who to reset").setRequired(true)))
    .addSubcommand(sub => sub
      .setName("all")
      .setDescription("Reset EVERYONE's stats — admin/bypass role only")),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "all") {
      // Wiping everyone's data is a bigger blast radius than resetting one
      // person, so this needs Administrator or the bypass role specifically —
      // regular staffRole members can still reset individual users below.
      const hasBypass = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)
        || interaction.member.roles.cache.has(config.bypassRole);
      if (!hasBypass) {
        return interaction.reply({ content: "Only admins/bypass role can reset everyone's stats.", ephemeral: true });
      }
      resetAll();
      return interaction.reply({ content: "🧹 Reset stats for **everyone**." });
    }

    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: "No permission.", ephemeral: true });
    }

    const target = interaction.options.getUser("user");
    resetUser(target.id);
    return interaction.reply({ content: `🧹 Reset stats for ${target}.` });
  }
};
