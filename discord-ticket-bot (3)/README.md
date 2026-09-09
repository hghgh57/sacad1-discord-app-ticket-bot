# Discord Ticket Bot

Features:
- Dropdown tickets (6 types), modal questions, per-category channels, claim/close, bypass role
- Staff & Builder DM applications: dropdown panel -> confirm in DMs -> step-by-step Q&A (text, dropdown, and image-upload questions) -> auto-posts to a review channel with Accept/Deny (deny asks for a reason) -> DMs the applicant the result
- Applications auto-expire after 3 hours of inactivity and can be cancelled at any time

## Project structure

```
config.js              - all IDs/env vars
utils.js                - shared helpers (isStaff, etc.)
tickets.js               - ticket type definitions + panel sender
applications.js          - application questions, session state, panel sender
commands/                - one file per slash command (data + execute)
  ticket-rename.js
  ticket-panel.js
  application-panel.js
deploy-commands.js       - registers commands from ./commands with Discord
index.js                 - loads commands, wires up all event handlers
```

### Adding a new slash command

1. Create a new file in `commands/`, e.g. `commands/my-command.js`:

   ```js
   const { SlashCommandBuilder } = require("discord.js");

   module.exports = {
     data: new SlashCommandBuilder()
       .setName("my-command")
       .setDescription("What it does"),

     async execute(interaction) {
       await interaction.reply("Hello!");
     }
   };
   ```

2. Run `npm run deploy` (or `node deploy-commands.js`) to register it with Discord.
3. Restart the bot (`npm start`) so it picks up the new file.

You do NOT need to edit `index.js` — it automatically loads every file in `commands/`.

## Discord Developer Portal setup

1. Go to https://discord.com/developers/applications -> your app -> **Bot**.
2. Under **Privileged Gateway Intents**, enable:
   - **Message Content Intent** (needed so the bot can read the answers people type in DMs)
3. You do NOT need "Server Members Intent" or "Presence Intent" for this bot — leave those off.
4. Under **OAuth2 -> URL Generator**, scope `bot` + `applications.commands`, permissions: Manage Channels, Manage Roles, Send Messages, Embed Links, Attach Files, Read Message History. Use the generated URL to invite the bot.
5. Make sure the bot's role sits above `bypassRole` where needed and above nothing it doesn't need to manage.
6. Users applying must have "Allow DMs from server members" enabled for this server, or the bot can't message them.

In code, the bot only requests these intents (already set in `index.js`): `Guilds`, `DirectMessages`, `MessageContent`, plus the `Channel`/`Message` partials (required so DM channels that aren't cached yet still fire events).

## Slash commands

- `/ticket-panel [channel]` — posts the ticket panel (defaults to the current channel). Staff/bypass-role only.
- `/application-panel [channel]` — posts the Staff & Builder application panel (defaults to the current channel). Staff/bypass-role only.
- `/ticket-rename name:<new-name>` — renames the ticket channel you run it in. Staff/bypass-role only, and only works inside an actual ticket channel.

"Staff/bypass-role only" means Administrator or whoever has the role in `bypassRole` in `config.js` — the same role that can already claim/close tickets and accept/deny applications.

### Registering commands

Commands are **no longer registered automatically on startup**. Instead, run the deploy script whenever you add, remove, or edit a command:

```
node deploy-commands.js            # registers to GUILD_ID — instant
node deploy-commands.js --global   # registers globally — can take up to an hour to show up
```

or with npm:

```
npm run deploy
npm run deploy:global
```

You only need to re-run this when the command *list* changes (new command, renamed command, changed options) — not every time the bot restarts.

## Environment variables (Railway)

Deploy on Railway as a normal Node project (it auto-detects `package.json` and runs `npm install && npm start`). Set these in Project -> Variables:

| Variable | Description |
|---|---|
| `BOT_TOKEN` | Your bot token (Developer Portal -> Bot -> Reset Token) — never commit this to `config.js` |
| `CLIENT_ID` | Your application/client ID — required by `deploy-commands.js` to register slash commands |
| `GUILD_ID` | Your server ID |

Everything else (channel IDs, category IDs, the bypass role ID) isn't sensitive, so it's just hardcoded directly in `config.js` — open it and paste your real IDs in place of the placeholder strings:

- `panelChannel`, `bypassRole`
- `categories.buying/selling/partnership/giveaway/gamble/help`
- `applicationPanelChannel`, `applicationReviewChannel`

To get an ID for a channel/category/role: enable Developer Mode (User Settings -> Advanced), then right-click it -> Copy ID.

## Local run

```
npm install
node deploy-commands.js
node index.js
```

For local testing, either set `BOT_TOKEN`/`CLIENT_ID`/`GUILD_ID` as environment variables, or temporarily hardcode them in `config.js` — just don't commit real tokens.
