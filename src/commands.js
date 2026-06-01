const { IANAZone } = require("luxon");
const { SlashCommandBuilder, ChannelType, MessageFlags } = require("discord.js");
const { encryptToken } = require("./crypto");

const EPHEMERAL = { flags: MessageFlags.Ephemeral };

function buildCommands() {
  const textChannel = (name, description) => (opt) =>
    opt.setName(name).setDescription(description).setRequired(true).addChannelTypes(ChannelType.GuildText);

  const linkSystem = new SlashCommandBuilder()
    .setName("link-system")
    .setDescription("link your discord account to a pluralkit system token.")
    .addStringOption((o) => o.setName("token").setDescription("pluralkit api token").setRequired(true))
    .addStringOption((o) =>
      o.setName("timezone").setDescription("optional iana timezone, e.g. America/New_York").setRequired(false)
    );

  const switches = new SlashCommandBuilder()
    .setName("switches")
    .setDescription("manage switch posting behavior and channels.")
    .addSubcommand((s) => s.setName("enable").setDescription("enable switch posting globally."))
    .addSubcommand((s) => s.setName("disable").setDescription("disable switch posting globally."))
    .addSubcommand((s) =>
      s.setName("add-channel").setDescription("add a channel for switch posts.").addChannelOption(textChannel("channel", "the channel to add"))
    )
    .addSubcommand((s) =>
      s
        .setName("remove-channel")
        .setDescription("remove a configured channel.")
        .addChannelOption(textChannel("channel", "the channel to remove"))
    )
    .addSubcommand((s) => s.setName("list-channels").setDescription("list configured channels."))
    .addSubcommand((s) =>
      s
        .setName("enable-channel")
        .setDescription("enable switch posting for a configured channel.")
        .addChannelOption(textChannel("channel", "the channel to enable"))
    )
    .addSubcommand((s) =>
      s
        .setName("disable-channel")
        .setDescription("disable switch posting for a configured channel.")
        .addChannelOption(textChannel("channel", "the channel to disable"))
    )
    .addSubcommand((s) =>
      s
        .setName("set-name-mode")
        .setDescription("set whether to show display or registered names.")
        .addStringOption((o) =>
          o
            .setName("mode")
            .setDescription("choose name mode")
            .setRequired(true)
            .addChoices(
              { name: "display", value: "display" },
              { name: "registered", value: "registered" }
            )
        )
    );

  const timezone = new SlashCommandBuilder()
    .setName("timezone")
    .setDescription("manage your switch embed timezone.")
    .addSubcommand((s) =>
      s
        .setName("set")
        .setDescription("set your iana timezone.")
        .addStringOption((o) => o.setName("value").setDescription("iana timezone, e.g. Europe/London").setRequired(true))
    )
    .addSubcommand((s) => s.setName("get").setDescription("get your currently configured timezone."));

  return [linkSystem, switches, timezone];
}

function isValidTimezone(value) {
  return IANAZone.isValidZone(value);
}

function formatChannelList(rows) {
  if (!rows.length) return "no channels configured yet.";
  const lines = rows.map((row) => `${row.enabled ? "✅" : "🚫"} <#${row.channel_id}>`);
  return `configured channels:\n\n${lines.join("\n")}`;
}

async function replyEphemeral(interaction, content) {
  await interaction.reply({ content, ...EPHEMERAL });
}

async function requireOwnedSystem(interaction, db) {
  const system = db.getSystemByOwner(interaction.user.id);
  if (!system) {
    await replyEphemeral(interaction, "no linked system found. run `/link-system` first.");
    return null;
  }
  return system;
}

async function handleLinkSystem(interaction, db, pkClient, encryptionKey) {
  await interaction.deferReply(EPHEMERAL);

  const token = interaction.options.getString("token", true).trim();
  const timezoneRaw = interaction.options.getString("timezone");
  const timezone = timezoneRaw?.trim() || "UTC";

  if (!isValidTimezone(timezone)) {
    await interaction.editReply("invalid timezone. please provide a valid iana timezone.");
    return;
  }

  try {
    const system = await pkClient.getOwnSystem(token);
    db.upsertSystem({
      systemId: system.id,
      systemName: system.name || null,
      ownerDiscordId: interaction.user.id,
      apiTokenEncrypted: encryptToken(token, encryptionKey),
      timezone
    });

    await interaction.editReply(
      `linked to system **${system.name || system.id}** (${system.id}). timezone set to **${timezone}**.`
    );
  } catch {
    await interaction.editReply("failed to validate your pluralkit token. please verify it and try again.");
  }
}

const SWITCH_HANDLERS = {
  enable: async (interaction, system, db) => {
    db.setSwitchesEnabled(system.system_id, true);
    await replyEphemeral(interaction, "global switch posting enabled. existing channel configs were preserved.");
  },
  disable: async (interaction, system, db) => {
    db.setSwitchesEnabled(system.system_id, false);
    await replyEphemeral(interaction, "global switch posting disabled. channel configs remain intact.");
  },
  "add-channel": async (interaction, system, db) => {
    const channel = interaction.options.getChannel("channel", true);
    db.addChannel(system.system_id, channel.id, interaction.guildId || "dm");
    await replyEphemeral(interaction, `added ${channel} and enabled posting for it.`);
  },
  "remove-channel": async (interaction, system, db) => {
    const channel = interaction.options.getChannel("channel", true);
    db.removeChannel(system.system_id, channel.id);
    await replyEphemeral(interaction, `removed ${channel} from your channel config.`);
  },
  "enable-channel": async (interaction, system, db) => {
    const channel = interaction.options.getChannel("channel", true);
    db.setChannelEnabled(system.system_id, channel.id, true);
    await replyEphemeral(interaction, `enabled switch posting for ${channel}.`);
  },
  "disable-channel": async (interaction, system, db) => {
    const channel = interaction.options.getChannel("channel", true);
    db.setChannelEnabled(system.system_id, channel.id, false);
    await replyEphemeral(interaction, `disabled switch posting for ${channel}.`);
  },
  "set-name-mode": async (interaction, system, db) => {
    const mode = interaction.options.getString("mode", true);
    db.setNamePreference(system.system_id, mode);
    await replyEphemeral(interaction, `member name mode set to **${mode}**.`);
  },
  "list-channels": async (interaction, system, db) => {
    await replyEphemeral(interaction, formatChannelList(db.listChannels(system.system_id)));
  }
};

async function handleSwitches(interaction, db) {
  const sub = interaction.options.getSubcommand();
  const system = await requireOwnedSystem(interaction, db);
  if (!system) return;

  const handler = SWITCH_HANDLERS[sub];
  if (handler) await handler(interaction, system, db);
}

async function handleTimezone(interaction, db) {
  const sub = interaction.options.getSubcommand();
  const system = await requireOwnedSystem(interaction, db);
  if (!system) return;

  if (sub === "get") {
    const mode = system.name_preference || "display";
    await replyEphemeral(
      interaction,
      `current timezone: **${system.timezone || "UTC"}**\ncurrent member name mode: **${mode}**`
    );
    return;
  }

  const value = interaction.options.getString("value", true).trim();
  if (!isValidTimezone(value)) {
    await replyEphemeral(interaction, "invalid timezone. please provide a valid iana timezone.");
    return;
  }

  db.setTimezone(system.system_id, value);
  await replyEphemeral(interaction, `timezone updated to **${value}**.`);
}

const COMMAND_HANDLERS = {
  "link-system": (interaction, deps) =>
    handleLinkSystem(interaction, deps.db, deps.pkClient, deps.encryptionKey),
  switches: (interaction, deps) => handleSwitches(interaction, deps.db),
  timezone: (interaction, deps) => handleTimezone(interaction, deps.db)
};

async function handleInteraction(interaction, deps) {
  if (!interaction.isChatInputCommand()) return;

  const handler = COMMAND_HANDLERS[interaction.commandName];
  if (!handler) return;

  try {
    await handler(interaction, deps);
  } catch {
    const content = "unexpected error while handling command.";
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content, ...EPHEMERAL });
      } else {
        await interaction.reply({ content, ...EPHEMERAL });
      }
    } catch {
      // ignore response errors
    }
  }
}

module.exports = {
  buildCommands,
  handleInteraction
};
