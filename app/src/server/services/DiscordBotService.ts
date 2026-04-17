import { injectable } from 'tsyringe';
import {
  Client,
  GatewayIntentBits,
  GuildMember,
  REST,
  Routes,
  SlashCommandBuilder,
  type APIInteractionGuildMember,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
  type Interaction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  MessageFlags,
} from 'discord.js';
import { logger } from '../logger.js';
import { ConfigService } from './ConfigService.js';
import { EcsService } from './EcsService.js';
import { DiscordConfigService, type DiscordAction } from './DiscordConfigService.js';

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

/** One action the bot can perform via slash command on a game. */
type BotAction = DiscordAction;

/** The shape of the `interaction.member` field for slash commands invoked in a guild. */
type InteractionMember = GuildMember | APIInteractionGuildMember;

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
 * - Delegates every incoming slash command through `DiscordConfigService.canRun()`
 *   for permission enforcement, then calls into `EcsService` for start/stop.
 *
 * Permission order lives in `DiscordConfigService.canRun()` — keep it there, not here.
 */
@injectable()
export class DiscordBotService {
  /** The live discord.js client while the bot is running; `null` when stopped. */
  private client: Client | null = null;
  /** Current lifecycle state — see {@link BotState}. */
  private state: BotState = 'stopped';
  /** Optional human-readable status (e.g. login error message). */
  private statusMessage: string | undefined;

  constructor(
    private readonly config: ConfigService,
    private readonly ecs: EcsService,
    private readonly discord: DiscordConfigService,
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

  /** Construct the four slash command descriptors. Returned as JSON ready to PUT to Discord. */
  private buildCommands(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
    const start = new SlashCommandBuilder()
      .setName('server-start')
      .setDescription('Start a game server')
      .addStringOption((o) =>
        o.setName('game').setDescription('Game to start').setRequired(true).setAutocomplete(true),
      );

    const stop = new SlashCommandBuilder()
      .setName('server-stop')
      .setDescription('Stop a running game server')
      .addStringOption((o) =>
        o.setName('game').setDescription('Game to stop').setRequired(true).setAutocomplete(true),
      );

    const status = new SlashCommandBuilder()
      .setName('server-status')
      .setDescription('Show status of a game server (or all if omitted)')
      .addStringOption((o) =>
        o.setName('game').setDescription('Game to check').setRequired(false).setAutocomplete(true),
      );

    const list = new SlashCommandBuilder()
      .setName('server-list')
      .setDescription('List all configured game servers and their state');

    return [start.toJSON(), stop.toJSON(), status.toJSON(), list.toJSON()];
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
        body: this.buildCommands(),
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
   * 3. For autocomplete, respond with filtered suggestions and stop.
   * 4. For slash commands: map name → action, extract `game` + invoker role IDs.
   * 5. `/server-list` and `/server-status` (no game arg) filter to games the user
   *    has `status` permission on; admins see everything.
   * 6. Otherwise, check `DiscordConfigService.canRun()` and either deny or
   *    dispatch to `EcsService` (with a deferred ephemeral reply).
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
      }
      // Autocomplete: silently drop — no allowlist leakage.
      return;
    }

    if (isAutocomplete) {
      await this.handleAutocomplete(interaction);
      return;
    }

    // isChatInput is true past this point.
    logger.info('Discord interaction received', {
      command: interaction.commandName,
      userId: interaction.user.id,
      guildId,
    });

    const action = this.commandToAction(interaction.commandName);
    if (!action) {
      logger.warn('Discord command with unknown name ignored', { command: interaction.commandName });
      return;
    }

    const game = interaction.options.getString('game') ?? undefined;
    const roleIds = this.extractRoleIds(interaction.member);

    if (interaction.commandName === 'server-list' || (!game && action === 'status')) {
      await this.replyVisibleList(interaction, guildId, roleIds);
      return;
    }

    if (!game) {
      await interaction.reply({ content: 'Game is required.', flags: MessageFlags.Ephemeral });
      return;
    }

    const allowed = this.discord.canRun({ guildId, userId: interaction.user.id, roleIds, game, action });
    if (!allowed) {
      logger.warn('Discord command denied', {
        guildId,
        userId: interaction.user.id,
        command: interaction.commandName,
        game,
      });
      await interaction.reply({
        content: `You don't have permission to ${action} **${game}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await this.dispatchAction(interaction, action, game);
  }

  /** Run the permitted action (`start`/`stop`/`status`) against `EcsService` and report back. */
  private async dispatchAction(
    interaction: ChatInputCommandInteraction,
    action: BotAction,
    game: string,
  ): Promise<void> {
    logger.info('Discord command dispatching', {
      command: interaction.commandName,
      userId: interaction.user.id,
      guildId: interaction.guildId,
      game,
    });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      if (action === 'start') {
        const result = await this.ecs.start(game);
        await interaction.editReply((result.success ? '✅ ' : '❌ ') + result.message);
      } else if (action === 'stop') {
        const result = await this.ecs.stop(game);
        await interaction.editReply((result.success ? '✅ ' : '❌ ') + result.message);
      } else {
        const status = await this.ecs.getStatus(game);
        await interaction.editReply(this.formatStatus(status));
      }
      logger.info('Discord command completed', { command: interaction.commandName, game });
    } catch (err) {
      logger.error('Discord command execution failed', { err, command: interaction.commandName, game });
      await interaction.editReply('❌ Command failed. Check server logs.');
    }
  }

  /**
   * Suggest game names from Terraform outputs that match the user's partial input.
   *
   * Permission-gated: the suggestion list is filtered to the games the invoker
   * can actually execute the *current* command on. So `/server-start <tab>`
   * only shows games the user has `start` permission on, and `/server-stop`
   * only shows `stop`. This keeps autocomplete visibility in sync with the
   * per-command `canRun()` check done at execution time instead of leaking
   * every configured game name to anyone in an allowlisted guild.
   */
  private async handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'game') return;
    const action = this.commandToAction(interaction.commandName);
    if (!action) {
      await interaction.respond([]).catch(() => undefined);
      return;
    }
    // Re-read Terraform state so new/removed games show up without a bot restart
    // (matches how /api/status handles the same concern in routes/games.ts).
    this.config.invalidateCache();
    const games = this.config.getTfOutputs()?.game_names ?? [];
    const query = focused.value.toLowerCase();
    const guildId = interaction.guildId;
    if (!guildId) {
      // Should have been filtered upstream; defend anyway.
      await interaction.respond([]).catch(() => undefined);
      return;
    }
    const roleIds = this.extractRoleIds(interaction.member);
    const matches = games
      .filter((g) => g.toLowerCase().includes(query))
      .filter((g) =>
        this.discord.canRun({ guildId, userId: interaction.user.id, roleIds, game: g, action }),
      )
      .slice(0, 25)
      .map((g) => ({ name: g, value: g }));
    await interaction.respond(matches).catch(() => undefined);
  }

  /**
   * Reply with a status summary, filtered to the games the caller has
   * `status` permission on (admins see everything). If no game is visible,
   * reply with a denial rather than an empty list so non-permitted users get
   * clear feedback instead of silently seeing "no games configured".
   */
  private async replyVisibleList(
    interaction: ChatInputCommandInteraction,
    guildId: string,
    roleIds: string[],
  ): Promise<void> {
    // Re-read Terraform state so the list reflects recent deploys (matches
    // /api/status behavior — see routes/games.ts).
    this.config.invalidateCache();
    const games = this.config.getTfOutputs()?.game_names ?? [];
    if (!games.length) {
      await interaction.reply({ content: 'No games configured.', flags: MessageFlags.Ephemeral });
      return;
    }
    const visible = games.filter((g) =>
      this.discord.canRun({ guildId, userId: interaction.user.id, roleIds, game: g, action: 'status' }),
    );
    if (!visible.length) {
      logger.warn('Discord list/status command denied (no visible games)', {
        guildId,
        userId: interaction.user.id,
        command: interaction.commandName,
      });
      await interaction.reply({
        content: "You don't have permission to view any server statuses.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const statuses = await Promise.all(visible.map((g) => this.ecs.getStatus(g)));
      const lines = statuses.map((s) => this.formatStatus(s));
      await interaction.editReply(lines.join('\n'));
    } catch (err) {
      logger.error('Failed to fetch Discord server statuses', {
        err,
        guildId,
        userId: interaction.user.id,
        command: interaction.commandName,
        visibleGames: visible,
      });
      const content = '❌ Could not fetch server statuses right now. Check server logs.';
      // deferReply may or may not have succeeded; pick the matching finisher
      // so we don't throw "already replied" on top of the original failure.
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(content).catch(() => undefined);
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
      }
    }
  }

  /** One-line status for a game: emoji + state + optional hostname/IP. */
  private formatStatus(status: { game: string; state: string; publicIp?: string; hostname?: string; message?: string }): string {
    const emoji =
      status.state === 'running' ? '🟢'
      : status.state === 'starting' ? '🟡'
      : status.state === 'stopped' ? '⚫'
      : '⚠️';
    const host = status.hostname ?? status.publicIp;
    const addr = host ? ` — \`${host}\`` : '';
    return `${emoji} **${status.game}**: ${status.state}${addr}`;
  }

  /** Map a slash command name to the permission-gated action it performs. */
  private commandToAction(name: string): BotAction | null {
    switch (name) {
      case 'server-start': return 'start';
      case 'server-stop': return 'stop';
      case 'server-status': return 'status';
      case 'server-list': return 'status';
      default: return null;
    }
  }

  /**
   * Extract the role IDs the invoker holds in the guild where the command ran.
   *
   * discord.js gives `interaction.member` one of two shapes:
   * - `GuildMember` (cached) — `.roles` is a `GuildMemberRoleManager` with a `cache` Collection keyed by role ID.
   * - `APIInteractionGuildMember` (uncached) — `.roles` is a `readonly string[]` of role IDs.
   *
   * We handle both explicitly instead of leaning on `any`; null means "no member" (shouldn't happen in a guild command).
   */
  private extractRoleIds(member: InteractionMember | null): string[] {
    if (!member) return [];
    if (member instanceof GuildMember) {
      return [...member.roles.cache.keys()];
    }
    // APIInteractionGuildMember: `roles` is a plain array of role IDs.
    return [...member.roles];
  }
}
