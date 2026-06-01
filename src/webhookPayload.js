function getSystemIdFromPayload(payload) {
  return payload?.system?.id || payload?.system_id || payload?.data?.system?.id || null;
}

function getSwitchFromPayload(payload) {
  if (payload?.switch?.timestamp) return payload.switch;
  if (payload?.data?.switch?.timestamp) return payload.data.switch;
  if (payload?.timestamp) return payload;
  return null;
}

module.exports = {
  getSystemIdFromPayload,
  getSwitchFromPayload
};
