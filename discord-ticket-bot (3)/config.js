module.exports = {
  // ==== From Railway variables ====
  token: process.env.BOT_TOKEN,
  clientId: process.env.CLIENT_ID, // not used yet — only needed if you add slash commands later
  guildId: process.env.GUILD_ID,

  // ==== Everything else — just paste your real IDs here ====
  panelChannel: "PANEL_CHANNEL_ID",
  bypassRole: "BYPASS_ROLE_ID",
  categories: {
    buying: "BUYING_CATEGORY_ID",
    selling: "SELLING_CATEGORY_ID",
    partnership: "PARTNERSHIP_CATEGORY_ID",
    giveaway: "GIVEAWAY_CATEGORY_ID",
    gamble: "GAMBLE_CATEGORY_ID",
    help: "HELP_CATEGORY_ID"
  },

  // Staff/Builder applications
  applicationPanelChannel: "APPLICATION_PANEL_CHANNEL_ID", // where the panel with the dropdown is posted
  applicationReviewChannel: "APPLICATION_REVIEW_CHANNEL_ID", // where finished applications get posted for Accept/Deny
  applicationTimeLimitMs: 3 * 60 * 60 * 1000, // 3 hours
  applicationsEnabled: {
    staff: true,
    builder: true
  }
};
