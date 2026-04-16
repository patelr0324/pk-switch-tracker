const { EmbedBuilder } = require("discord.js");
const { decryptToken } = require("./crypto");
const { formatSwitchTime } = require("./commands");

function normalizeHexColor(color) {
  if (!color || typeof color !== "string") return null;
  const normalized = color.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  return Number.parseInt(normalized, 16);
}

function cleanNameCandidate(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  if (lowered === "undefined" || lowered === "null") return null;
  return trimmed;
}

function resolveMemberName(member) {
  if (!member) return "unknown member";
  if (typeof member === "string") return `member ${member}`;

  return (
    cleanNameCandidate(member.display_name) ||
    cleanNameCandidate(member.name) ||
    cleanNameCandidate(member.member_name) ||
    cleanNameCandidate(member.id) ||
    cleanNameCandidate(member.uuid) ||
    "unknown member"
  );
}

function resolveMemberNameByMode(member, nameMode) {
  if (!member || typeof member !== "object") {
    return resolveMemberName(member);
  }

  if (nameMode === "registered") {
    return (
      cleanNameCandidate(member.name) ||
      cleanNameCandidate(member.member_name) ||
      cleanNameCandidate(member.display_name) ||
      cleanNameCandidate(member.id) ||
      "unknown member"
    );
  }

  return (
    cleanNameCandidate(member.display_name) ||
    cleanNameCandidate(member.name) ||
    cleanNameCandidate(member.member_name) ||
    cleanNameCandidate(member.id) ||
    "unknown member"
  );
}

function hasResolvableName(member) {
  if (!member || typeof member !== "object") return false;
  return Boolean(member.display_name || member.name || member.member_name);
}

function extractMemberId(member) {
  if (!member) return null;
  if (typeof member === "string") return member;
  if (typeof member !== "object") return null;
  return member.id || member.uuid || null;
}

function getFirstMemberObject(members) {
  const first = members[0];
  if (!first || typeof first !== "object") return null;
  return first;
}

function buildSwitchEmbed(systemName, members, timestamp, timezone, nameMode) {
  const names = members.map((member) => resolveMemberNameByMode(member, nameMode));
  const firstMember = getFirstMemberObject(members);
  const frontingText = names.length ? names.join(", ") : "unknown";
  const description = `**now fronting**\n${frontingText}`;

  const embed = new EmbedBuilder()
    .setTitle(systemName || "pluralkit system")
    .setDescription(description)
    .addFields({
      name: "time",
      value: formatSwitchTime(timestamp, timezone)
    });

  const color = normalizeHexColor(firstMember?.color);
  if (color !== null) embed.setColor(color);
  if (firstMember?.avatar_url) embed.setThumbnail(firstMember.avatar_url);

  return embed;
}

function hasRealMemberNames(members, nameMode) {
  if (!members.length) return false;
  return members.some((member) => resolveMemberNameByMode(member, nameMode) !== "unknown member");
}

async function hydrateSwitchMembers(members, token, pkClient) {
  const hydrated = [];
  const cache = new Map();

  for (const member of members) {
    const needsLookup = typeof member === "string" || !hasResolvableName(member);
    if (!needsLookup) {
      hydrated.push(member);
      continue;
    }

    const memberId = extractMemberId(member);
    if (!memberId) {
      hydrated.push(member);
      continue;
    }

    if (cache.has(memberId)) {
      hydrated.push(cache.get(memberId));
      continue;
    }

    try {
      const fetched = await pkClient.getMember(memberId, token);
      cache.set(memberId, fetched);
      hydrated.push(fetched);
    } catch (error) {
      hydrated.push(member);
    }
  }

  return hydrated;
}

function buildSwitchSignature(switchPayload, resolvedMembers, nameMode) {
  if (switchPayload?.id) {
    return `id:${switchPayload.id}`;
  }

  const timestamp = switchPayload?.timestamp || "unknown";
  const memberIds = resolvedMembers.map((member) => extractMemberId(member) || "unknown");
  const names = resolvedMembers.map((member) => resolveMemberNameByMode(member, nameMode));
  return `ts:${timestamp}|members:${memberIds.join(",")}|names:${names.join(",")}`;
}

async function processSystemSwitches(system, deps, options = {}) {
  const { db, pkClient, client, encryptionKey, postingGuildScopeId = null } = deps;
  const { latestSwitchOverride = null, source = "poll" } = options;
  if (!system.switches_enabled) {
    return;
  }

  let token;
  try {
    token = decryptToken(system.api_token_encrypted, encryptionKey);
  } catch (error) {
    return;
  }

  let latestSwitch = latestSwitchOverride;
  if (!latestSwitch || !latestSwitch.timestamp) {
    try {
      latestSwitch = await pkClient.getLatestSwitch(system.system_id, token);
    } catch (error) {
      console.error(`failed to fetch latest switch for ${system.system_id}:`, error.message);
      return;
    }
  }
  if (!latestSwitch?.timestamp) return;

  const rawMembers = Array.isArray(latestSwitch.members) ? latestSwitch.members : [];
  let resolvedMembers = await hydrateSwitchMembers(rawMembers, token, pkClient);
  const nameMode = system.name_preference || "display";

  if (!hasRealMemberNames(resolvedMembers, nameMode)) {
    try {
      const fronters = await pkClient.getCurrentFronters(system.system_id, token);
      const hydratedFronters = await hydrateSwitchMembers(fronters, token, pkClient);
      if (hasRealMemberNames(hydratedFronters, nameMode)) {
        resolvedMembers = hydratedFronters;
      }
    } catch (error) {
      // Keep resolvedMembers from switch payload if fallback call fails.
    }
  }

  const signature = buildSwitchSignature(
    latestSwitch,
    resolvedMembers,
    nameMode
  );
  const lastSwitchState = db.getLastSwitch(system.system_id);
  if (lastSwitchState?.last_switch_signature === signature) {
    return;
  }

  const channels = db.listChannels(system.system_id);
  const enabledChannels = channels.filter((row) => {
    if (!row.enabled) return false;
    if (postingGuildScopeId && row.guild_id !== postingGuildScopeId) return false;
    return true;
  });
  if (!enabledChannels.length) {
    db.updateLastSwitch(system.system_id, signature);
    return;
  }

  const embed = buildSwitchEmbed(
    system.system_name || system.system_id,
    resolvedMembers,
    latestSwitch.timestamp,
    system.timezone || "UTC",
    nameMode
  );

  let sentCount = 0;
  for (const row of enabledChannels) {
    try {
      const channel = await client.channels.fetch(row.channel_id);
      if (!channel || !channel.isTextBased()) continue;
      await channel.send({ embeds: [embed] });
      sentCount += 1;
    } catch (error) {
      console.error(
        `failed to send ${source} switch for ${system.system_id} to ${row.channel_id}:`,
        error.message
      );
    }
  }

  if (sentCount > 0) {
    db.updateLastSwitch(system.system_id, signature);
    return;
  }

  console.error(`switch relay failed for ${system.system_id}; no channels accepted message`);
}

function getSystemIdFromWebhookPayload(payload) {
  return payload?.system?.id || payload?.system_id || payload?.data?.system?.id || null;
}

function getSwitchFromWebhookPayload(payload) {
  if (payload?.switch && payload.switch.timestamp) return payload.switch;
  if (payload?.data?.switch && payload.data.switch.timestamp) return payload.data.switch;
  if (payload?.timestamp) return payload;
  return null;
}

function startSwitchRelay(deps, pollIntervalMs) {
  const pollOnce = async () => {
    const systems = deps.db.listAllSystems();
    for (const system of systems) {
      await processSystemSwitches(system, deps);
    }
  };

  const processWebhookPayload = async (payload) => {
    const systemId = getSystemIdFromWebhookPayload(payload);
    const incomingSwitch = getSwitchFromWebhookPayload(payload);

    if (!systemId) {
      await pollOnce();
      return;
    }

    const system = deps.db.getSystemById(systemId);
    if (!system) return;

    await processSystemSwitches(system, deps, {
      latestSwitchOverride: incomingSwitch,
      source: "webhook"
    });
  };

  pollOnce().catch((error) => {
    console.error("initial poll failed:", error.message);
  });
  const interval = setInterval(() => {
    pollOnce().catch((error) => {
      console.error("poll cycle failed:", error.message);
    });
  }, pollIntervalMs);

  return {
    stop: () => clearInterval(interval),
    pollOnce,
    processWebhookPayload
  };
}

module.exports = {
  startSwitchRelay
};
