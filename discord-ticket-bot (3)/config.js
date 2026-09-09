module.exports = {
  // ==== From Railway variables ====
  token: process.env.BOT_TOKEN,
  clientId: process.env.CLIENT_ID, // used by deploy-commands.js to register slash commands
  guildId: process.env.GUILD_ID,

  // ==== Everything else — just paste your real IDs here ====
  panelChannel: "PANEL_CHANNEL_ID",
  bypassRole: "1546728771208482876", // can always type in a ticket even after it's been claimed by someone else (bypasses the claim lock)
  staffRole: "1482008632747884736", // gets pinged + can see every new ticket as soon as it's created
  ticketLogChannel: "1477059741657206934", // where ticket opened/claimed/closed events get logged. Leave as-is (or "") to disable logging.
  categories: {
    buying: "1514955042958868551",
    selling: "1479693976087957596",
    partnership: "1514960184982634517",
    giveaway: "1477059744643547228",
    gamble: "1514961845021048944",
    help: "1479694579912671293"
  },

  // Service tickets (build orders — digout / base building)
  serviceCategories: {
    digout: "1537362856444567592",
    basebuilding: "1536144986641530880"
  },
  digoutPricePerUnit: 1000, // price = L x W x H x this
  priorityFeePercent: 20,   // rush priority fee, added on top of the base price

  // Staff/Builder applications
  applicationPanelChannel: "APPLICATION_PANEL_CHANNEL_ID", // where the panel with the dropdown is posted
  applicationReviewChannels: {
    staff: "1477265874560749588",   // finished staff applications get posted here for Accept/Deny
    builder: "1536248721384144947"  // finished builder applications get posted here for Accept/Deny
  },
  applicationTimeLimitMs: 3 * 60 * 60 * 1000, // 3 hours
  applicationsEnabled: {
    staff: true,
    builder: true
  },

  // Welcome messages (sent when a new member joins)
  welcome: {
    channel: "1466269532615086101", // channel where the welcome message gets posted
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
