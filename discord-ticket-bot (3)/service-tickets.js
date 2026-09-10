const {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, TextInputStyle
} = require("discord.js");
const config = require("./config");

// =====================================================================
// SERVICE TICKETS (build orders)
// Same shape as tickets.js, but this is a separate panel/dropdown with
// its own select menu id ("service_ticket") so it doesn't collide with
// the main ticket panel.
// =====================================================================
const serviceTickets = {
  digout: {
    emoji: "⛏️",
    label: "Digout Ticket",
    category: config.serviceCategories.digout,
    questions: [
      { label: "What is your IGN?", style: TextInputStyle.Short },
      {
        label: "What are the dimensions of the dig?",
        style: TextInputStyle.Short,
        placeholder: "e.g. 10 x 10 x 10"
      },
      {
        label: "Rush priority? (+20% fee)",
        style: TextInputStyle.Short,
        placeholder: "yes or no"
      }
    ]
  },
  basebuilding: {
    emoji: "🏗️",
    label: "Base Building Ticket",
    category: config.serviceCategories.basebuilding,
    questions: [
      { label: "What is your IGN?", style: TextInputStyle.Short },
      {
        label: "What build do you want?",
        style: TextInputStyle.Paragraph,
        placeholder: "Send schematic in ticke"
      },
      {
        label: "Rush priority? (+20% fee)",
        style: TextInputStyle.Short,
        placeholder: "yes or no"
      }
    ]
  }
};

// Pulls up to 3 numbers out of a free-typed dimensions string like
// "10x10x10", "10 x 10 x 5", "L:10 W:10 H:5", etc.
// Returns { l, w, h } or null if it couldn't find 3 numbers.
function parseDimensions(text) {
  const matches = (text.match(/[\d.]+/g) || []).map(Number).filter(n => !isNaN(n));
  if (matches.length < 3) return null;
  const [l, w, h] = matches;
  return { l, w, h };
}

// price = L x W x H x pricePerUnit, +priorityFeePercent% if priority
function calculateDigoutCost({ l, w, h }, priority) {
  const base = l * w * h * config.digoutPricePerUnit;
  const final = priority ? base * (1 + config.priorityFeePercent / 100) : base;
  return { base, final };
}

function formatPrice(n) {
  return Math.round(n).toLocaleString();
}

async function sendServiceTicketPanel(channel) {
  const e = new EmbedBuilder()
    .setColor("#8B5CF6")
    .setTitle("🛠️ Order a build ticket")
    .setDescription(
      "⛏️ **Digout Ticket**\n" +
      "Please provide L x W x H dimensions.\n\n" +
      "🏗️ **Base Building Ticket**\n" +
      "Open a ticket if you need a base built from a schematic.\n" +
      "Send the schematic file or link.\n\n" +
      "⚡ **Rush Priority**\n" +
      "+20% extra for priority queue\n\n" +
      "Please note all payments go though IGN : SacService\n" +
      "Never discuss in DMs"
    );
  const m = new StringSelectMenuBuilder().setCustomId("service_ticket").setPlaceholder("Select...")
    .addOptions(Object.entries(serviceTickets).map(([k, v]) => ({
      label: v.label, value: k, emoji: v.emoji, description: "Click on this option to create a ticket"
    })));
  await channel.send({ embeds: [e], components: [new ActionRowBuilder().addComponents(m)] });
}

module.exports = {
  serviceTickets,
  parseDimensions,
  calculateDigoutCost,
  formatPrice,
  sendServiceTicketPanel
};
