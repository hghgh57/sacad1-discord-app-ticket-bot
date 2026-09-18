const { SlashCommandBuilder } = require("discord.js");
const { isAdmin } = require("../utils");
const { getIGN, removeIGN, logIGNEvent } = require("../ign");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ign")
    .setDescription("Manage linked Minecraft IGNs")
    .addSubcommand(sc =>
      sc.setName("remove")
        .setDescription("Remove a user's linked IGN")
        .addUserOption(o => o.setName("user").setDescription("The user to unlink").setRequired(true))),

  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({ content: "No permission.", ephemeral: true });
    }

    if (interaction.options.getSubcommand() !== "remove") return;

    const user = interaction.options.getUser("user");
    const ign = getIGN(user.id);
    if (!ign) {
      return interaction.reply({ content: `${user} doesn't have an IGN linked.`, ephemeral: true });
    }

    removeIGN(user.id);

    // Try to strip the "[IGN]" suffix back off their nickname.
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (member) {
      const stripped = member.displayName.replace(/\s*\[.+\]$/, "").trim();
      await member.setNickname(stripped || null).catch(() => {});
    }

    await logIGNEvent(interaction.guild, {
      action: "Unlinked",
      user,
      ign,
      actionBy: interaction.user
    });

    return interaction.reply({ content: `Removed ${user}'s linked IGN (\`${ign}\`).`, ephemeral: true });
  }
};
