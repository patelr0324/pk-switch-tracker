const { REST, Routes } = require("discord.js");
const { buildCommands } = require("./commands");
const config = require("./config");

async function main() {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const body = buildCommands().map((cmd) => cmd.toJSON());

  if (config.devMode) {
    if (!config.discordGuildId) {
      throw new Error("DEV_MODE=true requires DISCORD_GUILD_ID for guild-scoped commands.");
    }
    await rest.put(
      Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
      { body }
    );
    console.log(`registered dev (guild) commands for ${config.discordGuildId}.`);
    return;
  }

  await rest.put(Routes.applicationCommands(config.discordClientId), { body });
  console.log("registered global application commands (all guilds).");
}

main().catch((error) => {
  console.error("failed to register commands:", error);
  process.exit(1);
});
