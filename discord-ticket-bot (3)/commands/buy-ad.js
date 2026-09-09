const { SlashCommandBuilder, ChannelType } = require("discord.js");
const { isStaff } = require("../utils");
const { sendBuyAdPanel } = require("../tickets");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("buy-ad")
    .setDescription("Send the buy ad panel")
    .addChannelOption(o => o.setName("channel").setDescription("Channel to send it in (defaults to this channel)").addChannelTypes(ChannelType.GuildText).setRequired(false)),

  async execute(interaction) {
    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: "No permission.", ephemeral: true });
    }

    const target = interaction.options.getChannel("channel") || interaction.channel;
    await sendBuyAdPanel(target);
    return interaction.reply({ content: `✅ Buy ad panel sent in ${target}.`, ephemeral: true });
  }
};
