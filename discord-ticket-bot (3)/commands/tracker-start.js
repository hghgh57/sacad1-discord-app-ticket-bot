const { SlashCommandBuilder, ActionRowBuilder, UserSelectMenuBuilder } = require("discord.js");
const { isAdmin } = require("../utils");

// This only kicks off step 1 (picking the users). Step 2 (the channel-ID
// modal) and the actual tracker creation happen in index.js, in response to
// the "tracker_select_users" select menu and "tracker_channel_modal" modal
// submit — because a modal can't be shown directly from a slash command
// reply, it has to come from a component interaction.
module.exports = {
  data: new SlashCommandBuilder()
    .setName("tracker-start")
    .setDescription("Start a new weekly tracker (claims/closes/renames/sponsors) — admin only"),

  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({ content: "No permission.", ephemeral: true });
    }

    const row = new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId("tracker_select_users")
        .setPlaceholder("Select the users to track")
        .setMinValues(1)
        .setMaxValues(25)
    );

    return interaction.reply({
      content: "👥 **Step 1/2** — select every user you want this tracker to follow (up to 25). Once you confirm, I'll ask for the channel to post it in.",
      components: [row],
      ephemeral: true
    });
  }
};
