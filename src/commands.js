const { DateTime, IANAZone } = require("luxon");
const { SlashCommandBuilder, ChannelType, MessageFlags } = require("discord.js");
const { encryptToken } = require("./crypto");

function buildCommands() {
  const linkSystem = new SlashCommandBuilder()
    .setName("link-system")
    .setDescription("link your discord account to a pluralkit system token.")
    .addStringOption((option) =>
      option.setName("token").setDescription("pluralkit api token").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("timezone")
        .setDescription("optional iana timezone, e.g. America/New_York")
        .setRequired(false)
    );

  const switches = new SlashCommandBuilder()
    .setName("switches")
    .setDescription("manage switch posting behavior and channels.")
    .addSubcommand((sub) => sub.setName("enable").setDescription("enable switch posting globally."))
    .addSubcommand((sub) => sub.setName("disable").setDescription("disable switch posting globally."))
    .addSubcommand((sub) =>
      sub
        .setName("add-channel")
        .setDescription("add a channel for switch posts.")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("the channel to add")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove-channel")
        .setDescription("remove a configured channel.")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("the channel to remove")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand((sub) => sub.setName("list-channels").setDescription("list configured channels."))
    .addSubcommand((sub) =>
      sub
        .setName("enable-channel")
        .setDescription("enable switch posting for a configured channel.")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("the channel to enable")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("disable-channel")
        .setDescription("disable switch posting for a configured channel.")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("the channel to disable")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("set-name-mode")
        .setDescription("set whether to show display or registered names.")
        .addStringOption((opt) =>
          opt
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
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("set your iana timezone.")
        .addStringOption((option) =>
          option
            .setName("value")
            .setDescription("iana timezone, e.g. Europe/London")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) => sub.setName("get").setDescription("get your currently configured timezone."));

  return [linkSystem, switches, timezone];
}

function validateTimezone(value) {
  return IANAZone.isValidZone(value);
}

function formatChannelList(rows) {
  if (!rows.length) {
    return "no channels configured yet.";
  }

  const lines = rows.map((row) => `${row.enabled ? "✅" : "🚫"} <#${row.channel_id}>`);
  return `configured channels:\n\n${lines.join("\n")}`;
}

async function requireOwnedSystem(interaction, db) {
  const system = db.getSystemByOwner(interaction.user.id);
  if (!system) {
    await interaction.reply({
      content: "no linked system found. run `/link-system` first.",
      flags: MessageFlags.Ephemeral
    });
    return null;
  }

  if (system.owner_discord_id !== interaction.user.id) {
    await interaction.reply({
      content: "you are not the owner of this linked system.",
      flags: MessageFlags.Ephemeral
    });
    return null;
  }

  return system;
}

async function handleLinkSystem(interaction, db, pkClient, encryptionKey) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const token = interaction.options.getString("token", true).trim();
  const timezoneRaw = interaction.options.getString("timezone");
  const timezone = timezoneRaw ? timezoneRaw.trim() : "UTC";

  if (!validateTimezone(timezone)) {
    await interaction.editReply("invalid timezone. please provide a valid iana timezone.");
    return;
  }

  try {
    const system = await pkClient.getOwnSystem(token);
    const encryptedToken = encryptToken(token, encryptionKey);

    db.upsertSystem({
      systemId: system.id,
      systemName: system.name || null,
      ownerDiscordId: interaction.user.id,
      apiTokenEncrypted: encryptedToken,
      timezone
    });

    await interaction.editReply(
      `linked to system **${system.name || system.id}** (${system.id}). timezone set to **${timezone}**.`
    );
  } catch (error) {
    await interaction.editReply("failed to validate your pluralkit token. please verify it and try again.");
  }
}

async function handleSwitches(interaction, db) {
  const sub = interaction.options.getSubcommand();
  const system = await requireOwnedSystem(interaction, db);
  if (!system) return;

  if (sub === "enable") {
    db.setSwitchesEnabled(system.system_id, true);
    await interaction.reply({
      content: "global switch posting enabled. existing channel configs were preserved.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (sub === "disable") {
    db.setSwitchesEnabled(system.system_id, false);
    await interaction.reply({
      content: "global switch posting disabled. channel configs remain intact.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (sub === "add-channel") {
    const channel = interaction.options.getChannel("channel", true);
    db.addChannel(system.system_id, channel.id, interaction.guildId || "dm");
    await interaction.reply({
      content: `added ${channel} and enabled posting for it.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (sub === "remove-channel") {
    const channel = interaction.options.getChannel("channel", true);
    db.removeChannel(system.system_id, channel.id);
    await interaction.reply({
      content: `removed ${channel} from your channel config.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (sub === "enable-channel" || sub === "disable-channel") {
    const channel = interaction.options.getChannel("channel", true);
    const isEnable = sub === "enable-channel";
    db.setChannelEnabled(system.system_id, channel.id, isEnable);
    await interaction.reply({
      content: `${isEnable ? "enabled" : "disabled"} switch posting for ${channel}.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (sub === "set-name-mode") {
    const mode = interaction.options.getString("mode", true);
    db.setNamePreference(system.system_id, mode);
    await interaction.reply({
      content: `member name mode set to **${mode}**.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (sub === "list-channels") {
    const rows = db.listChannels(system.system_id);
    await interaction.reply({
      content: formatChannelList(rows),
      flags: MessageFlags.Ephemeral
    });
  }
}

async function handleTimezone(interaction, db) {
  const sub = interaction.options.getSubcommand();
  const system = await requireOwnedSystem(interaction, db);
  if (!system) return;

  if (sub === "get") {
    const mode = system.name_preference || "display";
    await interaction.reply({
      content: `current timezone: **${system.timezone || "UTC"}**\ncurrent member name mode: **${mode}**`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const value = interaction.options.getString("value", true).trim();
  if (!validateTimezone(value)) {
    await interaction.reply({
      content: "invalid timezone. please provide a valid iana timezone.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  db.setTimezone(system.system_id, value);
  await interaction.reply({
    content: `timezone updated to **${value}**.`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleInteraction(interaction, deps) {
  const { db, pkClient, encryptionKey } = deps;
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "link-system") {
      await handleLinkSystem(interaction, db, pkClient, encryptionKey);
      return;
    }

    if (interaction.commandName === "switches") {
      await handleSwitches(interaction, db);
      return;
    }

    if (interaction.commandName === "timezone") {
      await handleTimezone(interaction, db);
    }
  } catch (error) {
    const content = "unexpected error while handling command.";
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    } catch (responseError) {
      // Prevent handler-level response failures from crashing the process.
    }
  }
}

function formatSwitchTime(timestamp, timezone) {
  return DateTime.fromISO(timestamp)
    .setZone(timezone || "UTC")
    .toFormat("MMM d, yyyy, h:mm a")
    .toLowerCase();
}

module.exports = {
  buildCommands,
  handleInteraction,
  formatSwitchTime
};
