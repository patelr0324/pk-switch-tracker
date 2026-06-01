const { DateTime } = require("luxon");

function formatSwitchTime(timestamp, timezone) {
  return DateTime.fromISO(timestamp)
    .setZone(timezone || "UTC")
    .toFormat("MMM d, yyyy, h:mm a")
    .toLowerCase();
}

module.exports = {
  formatSwitchTime
};
