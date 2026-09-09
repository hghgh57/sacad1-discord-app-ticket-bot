const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { calculateDigoutCost, formatPrice } = require("../service-tickets");
const config = require("../config");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("calculate")
    .setDescription("Calculate the price of a digout")
    .addNumberOption(o => o.setName("length").setDescription("Length (L)").setRequired(true))
    .addNumberOption(o => o.setName("width").setDescription("Width (W)").setRequired(true))
    .addNumberOption(o => o.setName("height").setDescription("Height (H)").setRequired(true))
    .addBooleanOption(o => o.setName("priority").setDescription("Add rush priority? (+20%)").setRequired(false)),

  async execute(interaction) {
    const l = interaction.options.getNumber("length");
    const w = interaction.options.getNumber("width");
    const h = interaction.options.getNumber("height");
    const priority = interaction.options.getBoolean("priority") || false;

    if (l <= 0 || w <= 0 || h <= 0) {
      return interaction.reply({ content: "❌ Dimensions have to be greater than 0.", ephemeral: true });
    }

    const { base, final } = calculateDigoutCost({ l, w, h }, priority);

    const embed = new EmbedBuilder()
      .setColor("#8B5CF6")
      .setTitle("💰 Digout Price Calculator")
      .addFields(
        { name: "Dimensions", value: `${l} x ${w} x ${h}`, inline: true },
        { name: "Priority", value: priority ? `Yes (+${config.priorityFeePercent}%)` : "No", inline: true },
        { name: "Base price", value: formatPrice(base), inline: false },
        { name: "Total", value: `**${formatPrice(final)}**`, inline: false }
      );

    return interaction.reply({ embeds: [embed] });
  }
};
