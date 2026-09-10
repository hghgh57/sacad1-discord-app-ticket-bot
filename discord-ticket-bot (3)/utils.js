const { PermissionsBitField } = require("discord.js");
const config = require("./config");

function isStaff(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator)
    || member.roles.cache.has(config.bypassRole)
    || member.roles.cache.has(config.staffRole);
}

// Same as isStaff, but also allows the build/digout ping role (config.buildTicketRole).
// Use this for actions inside service (digout/base building) tickets — claiming,
// renaming, etc. — where builders need to manage their own tickets, not just staff.
function isBuildStaff(member) {
  return isStaff(member) || member.roles.cache.has(config.buildTicketRole);
}

// Administrator permission or the bypass role specifically — narrower than
// isStaff (which also lets in the regular staffRole). Use this for things
// you want locked to actual admins/owners, not general staff.
function isAdmin(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator)
    || member.roles.cache.has(config.bypassRole);
}

module.exports = { isStaff, isBuildStaff, isAdmin };
