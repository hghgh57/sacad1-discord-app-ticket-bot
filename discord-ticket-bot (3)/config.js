module.exports = {
  // ==== From Railway variables ====
  token: process.env.BOT_TOKEN,
  clientId: process.env.CLIENT_ID, // used by deploy-commands.js to register slash commands
  guildId: process.env.GUILD_ID,

  // ==== Everything else — just paste your real IDs here ====
  panelChannel: "PANEL_CHANNEL_ID",
  bypassRole: "BYPASS_ROLE_ID", // can always type in a ticket even after it's been claimed by someone else (bypasses the claim lock)
  staffRole: "STAFF_ROLE_ID", // gets pinged + can see every new ticket as soon as it's created
  ticketLogChannel: "TICKET_LOG_CHANNEL_ID", // where ticket opened/claimed/closed events get logged. Leave as-is (or "") to disable logging.
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
  },

  // Welcome messages (sent when a new member joins)
  welcome: {
    channel: "WELCOME_CHANNEL_ID", // channel where the welcome message gets posted
    description:
      "Make sure to read <#1466270062322384926> \n" +
      "Enter all the giveaways below:\n" +
      "<#1456051574056026112> \n" +
      "<#1505822932327202816> \n" +
      "And watch out for <#1477093104849912008> \n" +
      "Make a <#1536144548269658183> Build ticket to order a build or digout\n" +
      "Make sure to show all channels aswell!\n\n" +
      "Enjoy your stay!"
  }
};
