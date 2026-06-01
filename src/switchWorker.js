const { decryptToken } = require("./crypto");
const {
  buildSwitchEmbed,
  buildSwitchSignature,
  membersHaveNames,
  hydrateMembers
} = require("./members");
const { getSystemIdFromPayload, getSwitchFromPayload } = require("./webhookPayload");

function logError(context, systemId, error) {
  console.error(`${context} for ${systemId}:`, error.message);
}

function decryptSystemToken(system, encryptionKey) {
  try {
    return decryptToken(system.api_token_encrypted, encryptionKey);
  } catch {
    return null;
  }
}

async function refreshSystemName(system, token, pkClient, db) {
  try {
    const pkSystem = await pkClient.getOwnSystem(token);
    if (pkSystem.id !== system.system_id) return;

    const name = pkSystem.name || null;
    db.setSystemName(system.system_id, name);
    system.system_name = name;
  } catch (error) {
    logError("failed to refresh system name", system.system_id, error);
  }
}

async function fetchLatestSwitch(system, token, pkClient, override) {
  if (override?.timestamp) return override;

  try {
    return await pkClient.getLatestSwitch(system.system_id, token);
  } catch (error) {
    logError("failed to fetch latest switch", system.system_id, error);
    return null;
  }
}

async function resolveFrontingMembers(system, latestSwitch, token, pkClient, nameMode) {
  const raw = Array.isArray(latestSwitch.members) ? latestSwitch.members : [];
  let members = await hydrateMembers(raw, token, pkClient);

  if (membersHaveNames(members, nameMode)) return members;

  try {
    const fronters = await pkClient.getCurrentFronters(system.system_id, token);
    const hydrated = await hydrateMembers(fronters, token, pkClient);
    if (membersHaveNames(hydrated, nameMode)) return hydrated;
  } catch {
    // keep members from switch payload
  }

  return members;
}

function listPostableChannels(db, systemId, guildScopeId) {
  return db.listChannels(systemId).filter((row) => {
    if (!row.enabled) return false;
    if (guildScopeId && row.guild_id !== guildScopeId) return false;
    return true;
  });
}

async function sendToChannels({ client, channels, embed, systemId, source }) {
  let sent = 0;

  for (const row of channels) {
    try {
      const channel = await client.channels.fetch(row.channel_id);
      if (!channel?.isTextBased()) continue;
      await channel.send({ embeds: [embed] });
      sent += 1;
    } catch (error) {
      console.error(
        `failed to send ${source} switch for ${systemId} to ${row.channel_id}:`,
        error.message
      );
    }
  }

  return sent;
}

async function processSystemSwitches(system, deps, options = {}) {
  const { db, pkClient, client, encryptionKey, postingGuildScopeId = null } = deps;
  const { latestSwitchOverride = null, source = "poll" } = options;

  const token = decryptSystemToken(system, encryptionKey);
  if (!token) return;

  await refreshSystemName(system, token, pkClient, db);
  if (!system.switches_enabled) return;

  const latestSwitch = await fetchLatestSwitch(system, token, pkClient, latestSwitchOverride);
  if (!latestSwitch?.timestamp) return;

  const nameMode = system.name_preference || "display";
  const members = await resolveFrontingMembers(system, latestSwitch, token, pkClient, nameMode);
  const signature = buildSwitchSignature(latestSwitch, members, nameMode);

  if (db.getLastSwitch(system.system_id)?.last_switch_signature === signature) return;

  const channels = listPostableChannels(db, system.system_id, postingGuildScopeId);
  if (!channels.length) {
    db.updateLastSwitch(system.system_id, signature);
    return;
  }

  const embed = buildSwitchEmbed({
    systemName: system.system_name || system.system_id,
    members,
    timestamp: latestSwitch.timestamp,
    timezone: system.timezone || "UTC",
    nameMode
  });

  const sent = await sendToChannels({
    client,
    channels,
    embed,
    systemId: system.system_id,
    source
  });

  if (sent > 0) {
    db.updateLastSwitch(system.system_id, signature);
    return;
  }

  console.error(`switch relay failed for ${system.system_id}; no channels accepted message`);
}

function startSwitchRelay(deps, pollIntervalMs) {
  const pollOnce = async () => {
    for (const system of deps.db.listAllSystems()) {
      await processSystemSwitches(system, deps);
    }
  };

  const processWebhookPayload = async (payload) => {
    const systemId = getSystemIdFromPayload(payload);

    if (!systemId) {
      await pollOnce();
      return;
    }

    const system = deps.db.getSystemById(systemId);
    if (!system) return;

    await processSystemSwitches(system, deps, {
      latestSwitchOverride: getSwitchFromPayload(payload),
      source: "webhook"
    });
  };

  const runPoll = (label) => {
    pollOnce().catch((error) => console.error(`${label}:`, error.message));
  };

  runPoll("initial poll failed");
  const interval = setInterval(() => runPoll("poll cycle failed"), pollIntervalMs);

  return {
    stop: () => clearInterval(interval),
    pollOnce,
    processWebhookPayload
  };
}

module.exports = {
  startSwitchRelay
};
