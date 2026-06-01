const { EmbedBuilder } = require("discord.js");
const { formatSwitchTime } = require("./format");

const UNKNOWN_MEMBER = "unknown member";

function cleanName(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  if (lowered === "undefined" || lowered === "null") return null;
  return trimmed;
}

function pickName(member, fields) {
  for (const field of fields) {
    const name = cleanName(member?.[field]);
    if (name) return name;
  }
  return UNKNOWN_MEMBER;
}

const DISPLAY_NAME_FIELDS = ["display_name", "name", "member_name", "id"];
const REGISTERED_NAME_FIELDS = ["name", "member_name", "display_name", "id"];

function resolveMemberName(member, nameMode = "display") {
  if (!member) return UNKNOWN_MEMBER;
  if (typeof member === "string") return `member ${member}`;
  if (typeof member !== "object") return UNKNOWN_MEMBER;

  const fields = nameMode === "registered" ? REGISTERED_NAME_FIELDS : DISPLAY_NAME_FIELDS;
  return pickName(member, fields);
}

function memberHasName(member) {
  return Boolean(member?.display_name || member?.name || member?.member_name);
}

function memberId(member) {
  if (!member) return null;
  if (typeof member === "string") return member;
  if (typeof member !== "object") return null;
  return member.id || member.uuid || null;
}

function firstMemberObject(members) {
  const first = members[0];
  return first && typeof first === "object" ? first : null;
}

function parseEmbedColor(color) {
  if (typeof color !== "string") return null;
  const hex = color.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return Number.parseInt(hex, 16);
}

function buildSwitchEmbed({ systemName, members, timestamp, timezone, nameMode }) {
  const fronting = members.map((m) => resolveMemberName(m, nameMode)).join(", ") || "unknown";
  const lead = firstMemberObject(members);

  const embed = new EmbedBuilder()
    .setTitle(systemName || "pluralkit system")
    .setDescription(`**now fronting**\n${fronting}`)
    .addFields({ name: "time", value: formatSwitchTime(timestamp, timezone) });

  const color = parseEmbedColor(lead?.color);
  if (color !== null) embed.setColor(color);
  if (lead?.avatar_url) embed.setThumbnail(lead.avatar_url);

  return embed;
}

function buildSwitchSignature(switchPayload, members, nameMode) {
  if (switchPayload?.id) return `id:${switchPayload.id}`;

  const timestamp = switchPayload?.timestamp || "unknown";
  const ids = members.map((m) => memberId(m) || "unknown").join(",");
  const names = members.map((m) => resolveMemberName(m, nameMode)).join(",");
  return `ts:${timestamp}|members:${ids}|names:${names}`;
}

function membersHaveNames(members, nameMode) {
  return members.some((m) => resolveMemberName(m, nameMode) !== UNKNOWN_MEMBER);
}

async function hydrateMembers(members, token, pkClient) {
  const cache = new Map();
  const hydrated = [];

  for (const member of members) {
    const needsFetch = typeof member === "string" || !memberHasName(member);
    if (!needsFetch) {
      hydrated.push(member);
      continue;
    }

    const id = memberId(member);
    if (!id) {
      hydrated.push(member);
      continue;
    }

    if (cache.has(id)) {
      hydrated.push(cache.get(id));
      continue;
    }

    try {
      const fetched = await pkClient.getMember(id, token);
      cache.set(id, fetched);
      hydrated.push(fetched);
    } catch {
      hydrated.push(member);
    }
  }

  return hydrated;
}

module.exports = {
  UNKNOWN_MEMBER,
  resolveMemberName,
  buildSwitchEmbed,
  buildSwitchSignature,
  membersHaveNames,
  hydrateMembers
};
