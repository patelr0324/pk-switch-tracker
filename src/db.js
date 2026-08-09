const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { encryptString, decryptString } = require("./crypto");

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function resolveSqlitePath(databasePath) {
  if (databasePath.toLowerCase().endsWith(".json")) {
    return databasePath.replace(/\.json$/i, ".db");
  }
  return databasePath;
}

function findLegacyJsonPath(sqlitePath, originalPath) {
  const candidates = [];
  if (originalPath.toLowerCase().endsWith(".json")) {
    candidates.push(originalPath);
  }
  candidates.push(path.join(path.dirname(sqlitePath), "bot-data.json"));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

class BotDatabase {
  constructor(databasePath, encryptionKey) {
    if (!encryptionKey) {
      throw new Error("BotDatabase requires an encryption key.");
    }

    this.encryptionKey = encryptionKey;
    this.originalPath = databasePath;
    this.filePath = resolveSqlitePath(databasePath);
    ensureParentDir(this.filePath);

    this.db = new DatabaseSync(this.filePath);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.#createSchema();
    this.#prepareStatements();
    this.#migrateFromJsonIfNeeded();
  }

  #createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS systems (
        system_id TEXT PRIMARY KEY,
        system_name TEXT,
        owner_discord_id TEXT NOT NULL UNIQUE,
        api_token_encrypted TEXT NOT NULL,
        switches_enabled INTEGER NOT NULL DEFAULT 0,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        name_preference TEXT NOT NULL DEFAULT 'display',
        interaction_status TEXT,
        interaction_status_revision INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS system_channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        system_id TEXT NOT NULL REFERENCES systems(system_id),
        channel_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        UNIQUE(system_id, channel_id)
      );

      CREATE TABLE IF NOT EXISTS last_switch (
        system_id TEXT PRIMARY KEY REFERENCES systems(system_id),
        last_switch_signature TEXT NOT NULL
      );
    `);
  }

  #prepareStatements() {
    this.stmts = {
      countSystems: this.db.prepare("SELECT COUNT(*) AS count FROM systems"),
      getSystemById: this.db.prepare("SELECT * FROM systems WHERE system_id = ?"),
      getSystemByOwner: this.db.prepare("SELECT * FROM systems WHERE owner_discord_id = ?"),
      listSystems: this.db.prepare("SELECT * FROM systems"),
      insertSystem: this.db.prepare(`
        INSERT INTO systems (
          system_id, system_name, owner_discord_id, api_token_encrypted,
          switches_enabled, timezone, name_preference,
          interaction_status, interaction_status_revision
        ) VALUES (?, ?, ?, ?, 0, ?, ?, NULL, 0)
      `),
      updateSystemLink: this.db.prepare(`
        UPDATE systems
        SET system_name = ?,
            owner_discord_id = ?,
            api_token_encrypted = ?,
            timezone = ?
        WHERE system_id = ?
      `),
      setSwitchesEnabled: this.db.prepare(
        "UPDATE systems SET switches_enabled = ? WHERE system_id = ?"
      ),
      setTimezone: this.db.prepare("UPDATE systems SET timezone = ? WHERE system_id = ?"),
      setNamePreference: this.db.prepare(
        "UPDATE systems SET name_preference = ? WHERE system_id = ?"
      ),
      setSystemName: this.db.prepare("UPDATE systems SET system_name = ? WHERE system_id = ?"),
      setInteractionStatus: this.db.prepare(`
        UPDATE systems
        SET interaction_status = ?,
            interaction_status_revision = interaction_status_revision + 1
        WHERE system_id = ?
      `),
      clearInteractionStatus: this.db.prepare(`
        UPDATE systems
        SET interaction_status = NULL,
            interaction_status_revision = interaction_status_revision + 1
        WHERE system_id = ?
      `),
      findChannel: this.db.prepare(
        "SELECT id FROM system_channels WHERE system_id = ? AND channel_id = ?"
      ),
      updateChannelGuild: this.db.prepare(
        "UPDATE system_channels SET guild_id = ? WHERE system_id = ? AND channel_id = ?"
      ),
      insertChannel: this.db.prepare(`
        INSERT INTO system_channels (system_id, channel_id, guild_id, enabled)
        VALUES (?, ?, ?, 1)
      `),
      removeChannel: this.db.prepare(
        "DELETE FROM system_channels WHERE system_id = ? AND channel_id = ?"
      ),
      setChannelEnabled: this.db.prepare(
        "UPDATE system_channels SET enabled = ? WHERE system_id = ? AND channel_id = ?"
      ),
      listChannels: this.db.prepare(
        "SELECT * FROM system_channels WHERE system_id = ? ORDER BY id ASC"
      ),
      getLastSwitch: this.db.prepare("SELECT * FROM last_switch WHERE system_id = ?"),
      upsertLastSwitch: this.db.prepare(`
        INSERT INTO last_switch (system_id, last_switch_signature)
        VALUES (?, ?)
        ON CONFLICT(system_id) DO UPDATE SET last_switch_signature = excluded.last_switch_signature
      `),
      insertSystemMigrate: this.db.prepare(`
        INSERT INTO systems (
          system_id, system_name, owner_discord_id, api_token_encrypted,
          switches_enabled, timezone, name_preference,
          interaction_status, interaction_status_revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      insertChannelMigrate: this.db.prepare(`
        INSERT INTO system_channels (id, system_id, channel_id, guild_id, enabled)
        VALUES (?, ?, ?, ?, ?)
      `),
      insertLastSwitchMigrate: this.db.prepare(`
        INSERT INTO last_switch (system_id, last_switch_signature)
        VALUES (?, ?)
      `),
      deleteChannelsBySystem: this.db.prepare("DELETE FROM system_channels WHERE system_id = ?"),
      deleteLastSwitchBySystem: this.db.prepare("DELETE FROM last_switch WHERE system_id = ?"),
      deleteSystem: this.db.prepare("DELETE FROM systems WHERE system_id = ?")
    };
  }

  #encryptNullable(value) {
    if (value == null) return null;
    return encryptString(String(value), this.encryptionKey);
  }

  #decryptNullable(value) {
    if (value == null) return null;
    return decryptString(value, this.encryptionKey);
  }

  #mapSystem(row) {
    if (!row) return null;
    return {
      system_id: row.system_id,
      system_name: this.#decryptNullable(row.system_name),
      owner_discord_id: row.owner_discord_id,
      api_token_encrypted: row.api_token_encrypted,
      switches_enabled: row.switches_enabled,
      timezone: row.timezone,
      name_preference: row.name_preference,
      interaction_status: this.#decryptNullable(row.interaction_status),
      interaction_status_revision: row.interaction_status_revision
    };
  }

  #mapChannel(row) {
    return {
      id: row.id,
      system_id: row.system_id,
      channel_id: row.channel_id,
      guild_id: row.guild_id,
      enabled: row.enabled
    };
  }

  #migrateFromJsonIfNeeded() {
    if (this.stmts.countSystems.get().count > 0) return;

    const legacyPath = findLegacyJsonPath(this.filePath, this.originalPath);
    if (!legacyPath) return;

    const raw = fs.readFileSync(legacyPath, "utf8");
    if (!raw.trim()) return;

    const parsed = JSON.parse(raw);
    const systems = Array.isArray(parsed.systems) ? parsed.systems : [];
    const channels = Array.isArray(parsed.system_channels) ? parsed.system_channels : [];
    const lastSwitches = Array.isArray(parsed.last_switch) ? parsed.last_switch : [];

    this.db.exec("BEGIN");
    try {
      for (const system of systems) {
        this.stmts.insertSystemMigrate.run(
          system.system_id,
          this.#encryptNullable(system.system_name ?? null),
          system.owner_discord_id,
          system.api_token_encrypted,
          system.switches_enabled ? 1 : 0,
          system.timezone || "UTC",
          system.name_preference || "display",
          this.#encryptNullable(system.interaction_status ?? null),
          system.interaction_status_revision || 0
        );
      }

      for (const channel of channels) {
        this.stmts.insertChannelMigrate.run(
          channel.id,
          channel.system_id,
          channel.channel_id,
          channel.guild_id,
          channel.enabled ? 1 : 0
        );
      }

      for (const entry of lastSwitches) {
        let signature = entry.last_switch_signature;
        if (!signature && entry.last_switch_timestamp) {
          signature = `legacy:${entry.last_switch_timestamp}`;
        }
        if (!signature) continue;
        this.stmts.insertLastSwitchMigrate.run(entry.system_id, signature);
      }

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    const bakPath = `${legacyPath}.bak`;
    fs.renameSync(legacyPath, bakPath);
    console.log(
      `migrated legacy json database from ${legacyPath} to ${this.filePath} (backup: ${bakPath})`
    );
  }

  getSystemById(systemId) {
    return this.#mapSystem(this.stmts.getSystemById.get(systemId));
  }

  getSystemByOwner(ownerDiscordId) {
    return this.#mapSystem(this.stmts.getSystemByOwner.get(ownerDiscordId));
  }

  listAllSystems() {
    return this.stmts.listSystems.all().map((row) => this.#mapSystem(row));
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
      this.stmts.updateSystemLink.run(
        this.#encryptNullable(systemName),
        ownerDiscordId,
        apiTokenEncrypted,
        timezone,
        systemId
      );
      return;
    }

    this.stmts.insertSystem.run(
      systemId,
      this.#encryptNullable(systemName),
      ownerDiscordId,
      apiTokenEncrypted,
      timezone,
      namePreference
    );
  }

  unlinkSystem(systemId) {
    if (!this.getSystemById(systemId)) return false;

    this.db.exec("BEGIN");
    try {
      this.stmts.deleteChannelsBySystem.run(systemId);
      this.stmts.deleteLastSwitchBySystem.run(systemId);
      this.stmts.deleteSystem.run(systemId);
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  setSwitchesEnabled(systemId, enabled) {
    if (!this.getSystemById(systemId)) return;
    this.stmts.setSwitchesEnabled.run(enabled ? 1 : 0, systemId);
  }

  setTimezone(systemId, timezone) {
    if (!this.getSystemById(systemId)) return;
    this.stmts.setTimezone.run(timezone, systemId);
  }

  setNamePreference(systemId, namePreference) {
    if (!this.getSystemById(systemId)) return;
    this.stmts.setNamePreference.run(namePreference, systemId);
  }

  setSystemName(systemId, systemName) {
    const system = this.getSystemById(systemId);
    if (!system) return;

    const next = systemName || null;
    if (system.system_name === next) return;

    this.stmts.setSystemName.run(this.#encryptNullable(next), systemId);
  }

  setInteractionStatus(systemId, value) {
    const system = this.getSystemById(systemId);
    if (!system) return { ok: false, changed: false };
    if (system.interaction_status === value) return { ok: true, changed: false };

    this.stmts.setInteractionStatus.run(this.#encryptNullable(value), systemId);
    return { ok: true, changed: true };
  }

  clearInteractionStatus(systemId) {
    const system = this.getSystemById(systemId);
    if (!system) return { ok: false, changed: false };
    if (!system.interaction_status) return { ok: true, changed: false };

    this.stmts.clearInteractionStatus.run(systemId);
    return { ok: true, changed: true };
  }

  addChannel(systemId, channelId, guildId) {
    if (this.stmts.findChannel.get(systemId, channelId)) {
      this.stmts.updateChannelGuild.run(guildId, systemId, channelId);
      return;
    }

    this.stmts.insertChannel.run(systemId, channelId, guildId);
  }

  removeChannel(systemId, channelId) {
    this.stmts.removeChannel.run(systemId, channelId);
  }

  setChannelEnabled(systemId, channelId, enabled) {
    this.stmts.setChannelEnabled.run(enabled ? 1 : 0, systemId, channelId);
  }

  listChannels(systemId) {
    return this.stmts.listChannels.all(systemId).map((row) => this.#mapChannel(row));
  }

  getLastSwitch(systemId) {
    const row = this.stmts.getLastSwitch.get(systemId);
    if (!row) return null;
    return {
      system_id: row.system_id,
      last_switch_signature: row.last_switch_signature
    };
  }

  updateLastSwitch(systemId, signature) {
    this.stmts.upsertLastSwitch.run(systemId, signature);
  }
}

module.exports = {
  BotDatabase
};
