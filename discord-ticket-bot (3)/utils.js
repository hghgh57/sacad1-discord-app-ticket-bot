const { PermissionsBitField } = require("discord.js");
const config = require("./config");

function isStaff(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator) || member.roles.cache.has(config.bypassRole);
}

module.exports = { isStaff };
