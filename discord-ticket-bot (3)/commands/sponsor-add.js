const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { isStaff } = require("../utils");
const { addSponsor } = require("../stats");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("sponsor-add")
    .setDescription("Log a sponsorship from a user")
    .addUserOption(o => o.setName("user").setDescription("Who sponsored").setRequired(true))
    .addNumberOption(o => o.setName("amount").setDescription("Amount sponsored").setRequired(true).setMinValue(0.01)),

  async execute(interaction) {
    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: "No permission.", ephemeral: true });
    }

    const target = interaction.options.getUser("user");
    const amount = interaction.options.getNumber("amount");
    const total = addSponsor(target.id, amount);

    const embed = new EmbedBuilder()
      .setColor("#8B5CF6")
      .setTitle("💸 Sponsorship logged")
      .addFields(
        { name: "Sponsor", value: `${target}`, inline: true },
        { name: "This sponsorship", value: `$${amount.toLocaleString()}`, inline: true },
        { name: "Total sponsored", value: `$${total.toLocaleString()}`, inline: true }
      )
      .setFooter({ text: `Logged by ${interaction.user.tag}` });

    return interaction.reply({ embeds: [embed] });
  }
};
