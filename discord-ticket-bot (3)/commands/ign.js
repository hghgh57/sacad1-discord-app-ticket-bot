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

    const removed = removeIGN(user.id);

    // Restore their nickname to whatever it was before they ever linked an
    // IGN. Falls back to stripping the "[IGN]" suffix if we don't have an
    // original name on record (e.g. entry created before this update).
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (member) {
      const restored = removed && removed.originalName
        ? removed.originalName
        : member.displayName.replace(/\s*\[.+\]$/, "").trim();
      await member.setNickname(restored || null).catch(() => {});
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
