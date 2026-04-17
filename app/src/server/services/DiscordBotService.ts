import { Injectable } from '@nestjs/common';
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  type Interaction,
  MessageFlags,
} from 'discord.js';
import { logger } from '../logger.js';
import { DiscordConfigService } from './DiscordConfigService.js';
import { SlashCommandRegistry } from '../discord/SlashCommandRegistry.js';
import { CommandInvoker } from '../discord/CommandInvoker.js';

/**
 * Lifecycle state of the Discord bot. Mapped 1:1 to the badge colors in the
 * web dashboard: running=green, starting=amber, error=red, stopped=dim.
 */
export type BotState = 'stopped' | 'starting' | 'running' | 'error';

/**
 * Redacted, client-safe snapshot of the bot's current state. Returned by
 * `DiscordBotService.getStatus()` and surfaced via `GET /api/discord/config`.
 * `clientId` / `username` are only populated once the discord.js client has
 * handed us its `application` / `user` objects after login.
 */
export interface BotStatus {
  /** Current lifecycle state. */
  state: BotState;
  /** The Discord application ID, once the client is logged in. */
  clientId: string | null;
  /** The bot account's display name, once the client is logged in. */
  username: string | null;
  /** IDs of guilds the client is currently connected to (intersected with the allowlist at ready). */
  connectedGuildIds: string[];
  /** Human-readable error / informational message — only set when useful to show. */
  message?: string;
}

/**
 * Owns the single shared `discord.js` `Client` instance for the app process.
 *
 * Responsibilities:
 * - Connects to Discord using the token from `DiscordConfigService` (env var
 *   `DISCORD_BOT_TOKEN` overrides the file).
 * - Registers slash commands **per-guild only** (never globally) so commands
 *   are never exposed to guilds outside the allowlist.
 * - Auto-leaves any guild that isn't on the allowlist, both at startup and on
 *   new `guildCreate` events.
 * - Dispatches every incoming interaction to the matching {@link SlashCommand}
 *   via {@link SlashCommandRegistry}. Per-command permission checks,
 *   option parsing, and service calls all live on the command class — this
 *   service is a thin transport/dispatcher.
 *
 * Permission order lives in `DiscordConfigService.canRun()` — keep it there, not here.
 */
@Injectable()
export class DiscordBotService {
  /** The live discord.js client while the bot is running; `null` when stopped. */
  private client: Client | null = null;
  /** Current lifecycle state — see {@link BotState}. */
  private state: BotState = 'stopped';
  /** Optional human-readable status (e.g. login error message). */
  private statusMessage: string | undefined;

  constructor(
    private readonly discord: DiscordConfigService,
    private readonly registry: SlashCommandRegistry,
  ) {}

  /** Redacted snapshot of the current bot state, safe to return to the web client. */
  getStatus(): BotStatus {
    return {
      state: this.state,
      clientId: this.client?.application?.id ?? null,
      username: this.client?.user?.username ?? null,
      connectedGuildIds: this.client ? [...this.client.guilds.cache.keys()] : [],
      ...(this.statusMessage ? { message: this.statusMessage } : {}),
    };
  }

  /**
   * Bring the bot online. Idempotent-ish: refuses to start if already running
   * or currently connecting. Returns a user-facing `{ success, message }` rather
   * than throwing so the caller (HTTP route or app boot) can surface it directly.
   */
  async start(): Promise<{ success: boolean; message: string }> {
    if (this.state === 'running' || this.state === 'starting') {
      return { success: false, message: 'Bot already running.' };
    }
    const token = this.discord.getEffectiveToken();
    if (!token) {
      this.state = 'stopped';
      this.statusMessage = 'No bot token configured.';
      return { success: false, message: this.statusMessage };
    }

    this.state = 'starting';
    this.statusMessage = undefined;
    this.client = this.createClient();
    this.attachListeners(this.client);
    return this.performLogin(this.client, token);
  }

  /** Disconnect the client (if any) and return to `stopped`. Safe to call repeatedly. */
  async stop(): Promise<void> {
    if (this.client) {
      try {
        await this.client.destroy();
      } catch (err) {
        logger.warn('Error destroying Discord client', { err });
      }
      this.client = null;
    }
    this.state = 'stopped';
  }

  /** Convenience: `stop()` then `start()`. Used by the UI "Restart Bot" button. */
  async restart(): Promise<{ success: boolean; message: string }> {
    await this.stop();
    return this.start();
  }

  /**
   * Construct the discord.js client with only the `Guilds` intent.
   *
   * We do *not* request `GuildMembers` (a privileged intent): for slash
   * commands, Discord already populates `interaction.member.roles` on the
   * command payload, so we don't need to fetch full member lists from the
   * gateway. Requesting it would force operators to enable the privileged
   * intent in the Developer Portal or the bot wouldn't start.
   */
  private createClient(): Client {
    return new Client({
      intents: [GatewayIntentBits.Guilds],
    });
  }

  /** Wire up the four event listeners the bot relies on. Kept separate from `start()` so the login flow is easy to read. */
  private attachListeners(client: Client): void {
    client.once('ready', async (c) => {
      logger.info('Discord bot ready', { username: c.user.username });
      this.state = 'running';
      await this.enforceGuildAllowlist();
      await this.registerCommandsForAllowedGuilds();
    });

    client.on('guildCreate', async (guild) => {
      await this.handleGuildJoin(guild);
    });

    client.on('interactionCreate', (interaction) => {
      void this.handleInteraction(interaction);
    });

    client.on('error', (err) => {
      logger.error('Discord client error', { err });
    });
  }

  /** Call `client.login(token)` and translate success/failure into the bot's state machine + API shape. */
  private async performLogin(client: Client, token: string): Promise<{ success: boolean; message: string }> {
    try {
      await client.login(token);
      return { success: true, message: 'Bot starting.' };
    } catch (err) {
      this.state = 'error';
      this.statusMessage = String(err);
      logger.error('Failed to login Discord bot', { err });
      this.client = null;
      return { success: false, message: this.statusMessage };
    }
  }

  /** Handle a `guildCreate` event: if the guild is allowlisted, register commands for it; otherwise leave. */
  private async handleGuildJoin(guild: { id: string; name: string; leave: () => Promise<unknown> }): Promise<void> {
    const allowed = this.discord.getConfig().allowedGuilds;
    if (!allowed.includes(guild.id)) {
      logger.warn('Leaving un-allowlisted guild', { guildId: guild.id, name: guild.name });
      await guild.leave().catch((err) => logger.error('Failed to leave guild', { err }));
      return;
    }
    await this.registerCommandsForGuild(guild.id);
  }

  /** On boot, drop any guild we're in that's no longer (or was never) allowlisted. */
  private async enforceGuildAllowlist(): Promise<void> {
    if (!this.client) return;
    const allowed = this.discord.getConfig().allowedGuilds;
    for (const [id, guild] of this.client.guilds.cache) {
      if (!allowed.includes(id)) {
        logger.warn('Leaving un-allowlisted guild at startup', { guildId: id, name: guild.name });
        await guild.leave().catch((err) => logger.error('Failed to leave guild', { err, guildId: id }));
      }
    }
  }

  /** Register commands for every allowlisted guild. Called once after `ready`. */
  private async registerCommandsForAllowedGuilds(): Promise<void> {
    const cfg = this.discord.getConfig();
    for (const guildId of cfg.allowedGuilds) {
      await this.registerCommandsForGuild(guildId);
    }
  }

  /**
   * Register the slash command set with Discord for a single guild.
   *
   * Called from the `ready` and `guildCreate` event handlers — both are
   * fire-and-forget from discord.js's perspective, so we must NOT throw
   * here. A thrown error would surface as an unhandled promise rejection
   * from the gateway client and destabilize the process. Instead we log
   * loudly and record the reason in `statusMessage` so operators see it
   * both in the server logs and on the dashboard status badge.
   */
  private async registerCommandsForGuild(guildId: string): Promise<void> {
    const token = this.discord.getEffectiveToken();
    const clientId = this.client?.application?.id ?? this.discord.getConfig().clientId;
    if (!token || !clientId) {
      const missing = [!token && 'bot token', !clientId && 'application/client ID']
        .filter(Boolean)
        .join(' and ');
      const message = `Cannot register slash commands for guild ${guildId}: missing ${missing}. Set it in the Discord panel or via DISCORD_BOT_TOKEN.`;
      logger.error(message);
      this.statusMessage = message;
      return;
    }
    try {
      const rest = new REST({ version: '10' }).setToken(token);
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: this.registry.buildAll(),
      });
      logger.info('Registered slash commands for guild', { guildId });
    } catch (err) {
      logger.error('Failed to register slash commands', { err, guildId });
    }
  }

  /**
   * Dispatcher for every incoming interaction (slash command or autocomplete).
   *
   * Flow:
   * 1. Reject interactions we don't handle (not slash command, not autocomplete).
   * 2. Enforce guild + allowlist for both types — autocomplete is also gated so
   *    non-allowlisted guilds never see configured game names suggested.
   * 3. Look up the matching {@link SlashCommand} in the registry and delegate:
   *    autocomplete → `command.autocomplete(ctx)`; chat input → `command.execute(ctx)`.
   *    Per-command permission checks, option parsing, and service dispatch all
   *    live on the command class.
   */
  private async handleInteraction(interaction: Interaction): Promise<void> {
    const isAutocomplete = interaction.isAutocomplete();
    const isChatInput = interaction.isChatInputCommand();
    if (!isAutocomplete && !isChatInput) return;

    const guildId = interaction.guildId;
    if (!guildId) {
      if (isChatInput) {
        logger.warn('Discord command in DM rejected', { userId: interaction.user.id, command: interaction.commandName });
        await interaction.reply({ content: 'This bot only works in configured servers.', flags: MessageFlags.Ephemeral });
      } else {
        // Autocomplete: respond with no suggestions rather than timing out —
        // an unanswered autocomplete surfaces to the user as "interaction failed".
        await interaction.respond([]).catch(() => undefined);
      }
      return;
    }
    const cfg = this.discord.getConfig();
    if (!cfg.allowedGuilds.includes(guildId)) {
      if (isChatInput) {
        logger.warn('Discord command from non-allowlisted guild rejected', {
          guildId,
          userId: interaction.user.id,
          command: interaction.commandName,
        });
        await interaction.reply({ content: 'This server is not allowlisted.', flags: MessageFlags.Ephemeral });
      } else {
        // Autocomplete: respond empty rather than silently drop. Empty still
        // hides configured game names from non-allowlisted guilds (no leakage).
        await interaction.respond([]).catch(() => undefined);
      }
      return;
    }

    const command = this.registry.get(interaction.commandName);
    if (!command) {
      if (isChatInput) {
        logger.warn('Discord command with unknown name ignored', { command: interaction.commandName });
      } else {
        await interaction.respond([]).catch(() => undefined);
      }
      return;
    }

    const invoker = CommandInvoker.from(interaction, this.discord);
    if (!invoker) {
      // Defensive: guildId was already checked above, so this shouldn't happen.
      if (isAutocomplete) await interaction.respond([]).catch(() => undefined);
      return;
    }

    if (isAutocomplete) {
      const focused = interaction.options.getFocused(true);
      await command.autocomplete({ interaction, invoker, focused: { name: focused.name, value: focused.value } });
      return;
    }

    // isChatInput past this point.
    logger.info('Discord interaction received', {
      command: interaction.commandName,
      userId: interaction.user.id,
      guildId,
    });
    await command.execute({ interaction, invoker });
  }
}
