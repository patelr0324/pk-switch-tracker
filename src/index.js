const { Client, GatewayIntentBits } = require("discord.js");
const config = require("./config");
const { BotDatabase } = require("./db");
const { PKClient } = require("./pkClient");
const { handleInteraction } = require("./commands");
const { startSwitchRelay } = require("./switchWorker");
const { startWebhookServer } = require("./webhookServer");

const db = new BotDatabase(config.databasePath);
const pkClient = new PKClient(config.pkApiBase, {
  timeoutMs: config.pkApiTimeoutMs,
  maxRetries: config.pkApiMaxRetries
});

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let relay = null;

const relayDeps = () => ({
  db,
  pkClient,
  client,
  encryptionKey: config.tokenEncryptionKey,
  postingGuildScopeId: config.devMode ? config.discordGuildId : null
});

client.once("clientReady", () => {
  console.log(`bot logged in as ${client.user.tag}`);

  if (config.devMode) {
    if (!config.discordGuildId) {
      console.error("dev mode is on but DISCORD_GUILD_ID is empty; no guild scope can be applied");
    } else {
      console.log(`dev mode enabled: posting scoped to guild ${config.discordGuildId}`);
    }
  } else {
    console.log("dev mode disabled: posting allowed in all configured guilds");
  }

  relay = startSwitchRelay(relayDeps(), config.pollIntervalMs);
});

client.on("interactionCreate", (interaction) =>
  handleInteraction(interaction, {
    db,
    pkClient,
    encryptionKey: config.tokenEncryptionKey
  }).catch((error) => console.error("unhandled interaction error:", error))
);

client.login(config.discordToken).catch((error) => {
  console.error("failed to login:", error);
  process.exit(1);
});

startWebhookServer({ config, getRelay: () => relay });
