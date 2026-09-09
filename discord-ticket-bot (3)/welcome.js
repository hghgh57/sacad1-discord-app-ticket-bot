const { EmbedBuilder } = require("discord.js");
const config = require("./config");

async function sendWelcomeMessage(member) {
  if (!config.welcome.channel) return;
  const channel = await member.guild.channels.fetch(config.welcome.channel).catch(() => null);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor("#8B5CF6")
    .setDescription(config.welcome.description);

  await channel.send({ content: `Welcome ${member}`, embeds: [embed] }).catch(() => {});
}

module.exports = { sendWelcomeMessage };
