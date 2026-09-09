const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");

// =====================================================================
// TICKET SYSTEM (unchanged behaviour from the original bot)
// =====================================================================
const tickets = {
  buying: ["🦴", "Buying Spawners"],
  selling: ["🦴", "Sell Spawners"],
  partnership: ["🤝", "Partnership"],
  giveaway: ["💵", "Giveaway Claim/Sponsor"],
  gamble: ["🤑", "Missed Gamble"],
  help: ["⚙️", "General Help"]
};

async function sendTicketPanel(channel) {
  const e = new EmbedBuilder().setColor("#8B5CF6").setTitle("🎫 Support Tickets").setDescription("Choose a ticket below.");
  const m = new StringSelectMenuBuilder().setCustomId("ticket").setPlaceholder("Select...")
    .addOptions(Object.entries(tickets).map(([k, v]) => ({ label: v[1], value: k, emoji: v[0], description: "Click on this option to create a ticket" })));
  await channel.send({ embeds: [e], components: [new ActionRowBuilder().addComponents(m)] });
}

module.exports = { tickets, sendTicketPanel };
