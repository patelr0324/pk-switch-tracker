const fs = require("fs");
const path = require("path");

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

class BotDatabase {
  constructor(databasePath) {
    this.filePath = databasePath;
    this.data = {
      systems: [],
      system_channels: [],
      last_switch: []
    };
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
      if (!system.name_preference) {
        system.name_preference = "display";
      }
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
        name_preference: namePreference
      });
    }

    this.flush();
  }

  getSystemByOwner(ownerDiscordId) {
    return this.data.systems.find((row) => row.owner_discord_id === ownerDiscordId) || null;
  }

  getSystemById(systemId) {
    return this.data.systems.find((row) => row.system_id === systemId) || null;
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

  addChannel(systemId, channelId, guildId) {
    const existing = this.data.system_channels.find(
      (row) => row.system_id === systemId && row.channel_id === channelId
    );
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
    const existing = this.data.system_channels.find(
      (row) => row.system_id === systemId && row.channel_id === channelId
    );
    if (!existing) return;
    existing.enabled = enabled ? 1 : 0;
    this.flush();
  }

  listChannels(systemId) {
    return this.data.system_channels
      .filter((row) => row.system_id === systemId)
      .sort((a, b) => a.id - b.id);
  }

  listAllSystems() {
    return [...this.data.systems];
  }

  getLastSwitch(systemId) {
    const row = this.data.last_switch.find((entry) => entry.system_id === systemId);
    return row || null;
  }

  updateLastSwitch(systemId, signature) {
    const existing = this.data.last_switch.find((entry) => entry.system_id === systemId);
    if (existing) {
      existing.last_switch_signature = signature;
    } else {
      this.data.last_switch.push({
        system_id: systemId,
        last_switch_signature: signature
      });
    }
    this.flush();
  }
}

module.exports = {
  BotDatabase
};
