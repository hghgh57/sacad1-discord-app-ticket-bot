const { PermissionsBitField } = require("discord.js");
const config = require("./config");

// The server owner and anyone with config.fullAccessRole always pass every
// permission check in the bot (isStaff, isBuildStaff, isAdmin) — same as if
// they had every staff/bypass role at once. Checked first since it's cheap
// and applies everywhere.
function hasFullAccess(member) {
  return member.id === member.guild.ownerId
    || member.roles.cache.has(config.fullAccessRole);
}

function isStaff(member) {
  return hasFullAccess(member)
    || member.permissions.has(PermissionsBitField.Flags.Administrator)
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
// you want locked to actual admins/owners, not general staff. The owner and
// fullAccessRole still always pass, same as isStaff.
function isAdmin(member) {
  return hasFullAccess(member)
    || member.permissions.has(PermissionsBitField.Flags.Administrator)
    || member.roles.cache.has(config.bypassRole);
}

module.exports = { isStaff, isBuildStaff, isAdmin, hasFullAccess };
