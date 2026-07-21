const fs = require("fs");
const path = require("path");

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

class BotDatabase {
  constructor(databasePath) {
    this.filePath = databasePath;
    this.data = { systems: [], system_channels: [], last_switch: [] };
    this.nextChannelId = 1;
    this.init();
  }

  init() {
    ensureParentDir(this.filePath);

    if (!fs.existsSync(this.filePath)) {
      this.flush();
      return;
    }

    const raw = fs.readFileSync(this.filePath, "utf8");
    if (!raw.trim()) {
      this.flush();
      return;
    }

    const parsed = JSON.parse(raw);
    this.data.systems = Array.isArray(parsed.systems) ? parsed.systems : [];
    this.data.system_channels = Array.isArray(parsed.system_channels) ? parsed.system_channels : [];
    this.data.last_switch = Array.isArray(parsed.last_switch) ? parsed.last_switch : [];

    for (const system of this.data.systems) {
      if (!system.name_preference) system.name_preference = "display";
      if (system.interaction_status === undefined) system.interaction_status = null;
      if (system.interaction_status_revision === undefined) system.interaction_status_revision = 0;
    }

    for (const entry of this.data.last_switch) {
      if (!entry.last_switch_signature && entry.last_switch_timestamp) {
        entry.last_switch_signature = `legacy:${entry.last_switch_timestamp}`;
      }
      delete entry.last_switch_timestamp;
    }

    const maxId = this.data.system_channels.reduce((max, row) => Math.max(max, row.id || 0), 0);
    this.nextChannelId = maxId + 1;
    this.flush();
  }

  flush() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
  }

  getSystemById(systemId) {
    return this.data.systems.find((row) => row.system_id === systemId) || null;
  }

  getSystemByOwner(ownerDiscordId) {
    return this.data.systems.find((row) => row.owner_discord_id === ownerDiscordId) || null;
  }

  listAllSystems() {
    return [...this.data.systems];
  }

  _findChannel(systemId, channelId) {
    return this.data.system_channels.find(
      (row) => row.system_id === systemId && row.channel_id === channelId
    );
  }

  upsertSystem({
    systemId,
    systemName = null,
    ownerDiscordId,
    apiTokenEncrypted,
    timezone = "UTC",
    namePreference = "display"
  }) {
    const existing = this.getSystemById(systemId);

    if (existing) {
      existing.system_name = systemName;
      existing.owner_discord_id = ownerDiscordId;
      existing.api_token_encrypted = apiTokenEncrypted;
      existing.timezone = timezone;
      existing.name_preference = existing.name_preference || namePreference;
    } else {
      this.data.systems.push({
        system_id: systemId,
        system_name: systemName,
        owner_discord_id: ownerDiscordId,
        api_token_encrypted: apiTokenEncrypted,
        switches_enabled: 0,
        timezone,
        name_preference: namePreference,
        interaction_status: null,
        interaction_status_revision: 0
      });
    }

    this.flush();
  }

  setSwitchesEnabled(systemId, enabled) {
    const system = this.getSystemById(systemId);
    if (!system) return;
    system.switches_enabled = enabled ? 1 : 0;
    this.flush();
  }

  setTimezone(systemId, timezone) {
    const system = this.getSystemById(systemId);
    if (!system) return;
    system.timezone = timezone;
    this.flush();
  }

  setNamePreference(systemId, namePreference) {
    const system = this.getSystemById(systemId);
    if (!system) return;
    system.name_preference = namePreference;
    this.flush();
  }

  setSystemName(systemId, systemName) {
    const system = this.getSystemById(systemId);
    if (!system) return;

    const next = systemName || null;
    if (system.system_name === next) return;

    system.system_name = next;
    this.flush();
  }

  _bumpInteractionStatusRevision(system) {
    system.interaction_status_revision = (system.interaction_status_revision || 0) + 1;
  }

  setInteractionStatus(systemId, value) {
    const system = this.getSystemById(systemId);
    if (!system) return { ok: false, changed: false };
    if (system.interaction_status === value) return { ok: true, changed: false };

    system.interaction_status = value;
    this._bumpInteractionStatusRevision(system);
    this.flush();
    return { ok: true, changed: true };
  }

  clearInteractionStatus(systemId) {
    const system = this.getSystemById(systemId);
    if (!system) return { ok: false, changed: false };
    if (!system.interaction_status) return { ok: true, changed: false };

    system.interaction_status = null;
    this._bumpInteractionStatusRevision(system);
    this.flush();
    return { ok: true, changed: true };
  }

  addChannel(systemId, channelId, guildId) {
    const existing = this._findChannel(systemId, channelId);

    if (existing) {
      existing.guild_id = guildId;
    } else {
      this.data.system_channels.push({
        id: this.nextChannelId++,
        system_id: systemId,
        channel_id: channelId,
        guild_id: guildId,
        enabled: 1
      });
    }

    this.flush();
  }

  removeChannel(systemId, channelId) {
    this.data.system_channels = this.data.system_channels.filter(
      (row) => !(row.system_id === systemId && row.channel_id === channelId)
    );
    this.flush();
  }

  setChannelEnabled(systemId, channelId, enabled) {
    const row = this._findChannel(systemId, channelId);
    if (!row) return;
    row.enabled = enabled ? 1 : 0;
    this.flush();
  }

  listChannels(systemId) {
    return this.data.system_channels
      .filter((row) => row.system_id === systemId)
      .sort((a, b) => a.id - b.id);
  }

  getLastSwitch(systemId) {
    return this.data.last_switch.find((entry) => entry.system_id === systemId) || null;
  }

  updateLastSwitch(systemId, signature) {
    const existing = this.data.last_switch.find((entry) => entry.system_id === systemId);

    if (existing) {
      existing.last_switch_signature = signature;
    } else {
      this.data.last_switch.push({ system_id: systemId, last_switch_signature: signature });
    }

    this.flush();
  }
}

module.exports = {
  BotDatabase
};
