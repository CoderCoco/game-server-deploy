import { injectable } from 'tsyringe';
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
  type Interaction,
  MessageFlags,
} from 'discord.js';
import { logger } from '../logger.js';
import { ConfigService } from './ConfigService.js';
import { EcsService } from './EcsService.js';
import { DiscordConfigService, type DiscordAction } from './DiscordConfigService.js';

type BotState = 'stopped' | 'starting' | 'running' | 'error';

export interface BotStatus {
  state: BotState;
  clientId: string | null;
  username: string | null;
  connectedGuildIds: string[];
  message?: string;
}

@injectable()
export class DiscordBotService {
  private client: Client | null = null;
  private state: BotState = 'stopped';
  private statusMessage: string | undefined;

  constructor(
    private readonly config: ConfigService,
    private readonly ecs: EcsService,
    private readonly discord: DiscordConfigService,
  ) {}

  getStatus(): BotStatus {
    return {
      state: this.state,
      clientId: this.client?.application?.id ?? null,
      username: this.client?.user?.username ?? null,
      connectedGuildIds: this.client ? [...this.client.guilds.cache.keys()] : [],
      ...(this.statusMessage ? { message: this.statusMessage } : {}),
    };
  }

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
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    });

    this.client.once('ready', async (c) => {
      logger.info('Discord bot ready', { username: c.user.username });
      this.state = 'running';
      await this.enforceGuildAllowlist();
      await this.registerCommandsForAllowedGuilds();
    });

    this.client.on('guildCreate', async (guild) => {
      const allowed = this.discord.getConfig().allowedGuilds;
      if (!allowed.includes(guild.id)) {
        logger.warn('Leaving un-allowlisted guild', { guildId: guild.id, name: guild.name });
        await guild.leave().catch((err) => logger.error('Failed to leave guild', { err }));
        return;
      }
      await this.registerCommandsForGuild(guild.id);
    });

    this.client.on('interactionCreate', (interaction) => {
      void this.handleInteraction(interaction);
    });

    this.client.on('error', (err) => {
      logger.error('Discord client error', { err });
    });

    try {
      await this.client.login(token);
      return { success: true, message: 'Bot starting.' };
    } catch (err) {
      this.state = 'error';
      this.statusMessage = String(err);
      logger.error('Failed to login Discord bot', { err });
      this.client = null;
      return { success: false, message: this.statusMessage };
    }
  }

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

  async restart(): Promise<{ success: boolean; message: string }> {
    await this.stop();
    return this.start();
  }

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

  private buildCommands() {
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

  private async registerCommandsForAllowedGuilds(): Promise<void> {
    const cfg = this.discord.getConfig();
    for (const guildId of cfg.allowedGuilds) {
      await this.registerCommandsForGuild(guildId);
    }
  }

  private async registerCommandsForGuild(guildId: string): Promise<void> {
    const token = this.discord.getEffectiveToken();
    const clientId = this.client?.application?.id ?? this.discord.getConfig().clientId;
    if (!token || !clientId) return;
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

  private async handleInteraction(interaction: Interaction): Promise<void> {
    if (interaction.isAutocomplete()) {
      await this.handleAutocomplete(interaction);
      return;
    }
    if (!interaction.isChatInputCommand()) return;

    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({ content: 'This bot only works in configured servers.', flags: MessageFlags.Ephemeral });
      return;
    }
    const cfg = this.discord.getConfig();
    if (!cfg.allowedGuilds.includes(guildId)) {
      await interaction.reply({ content: 'This server is not allowlisted.', flags: MessageFlags.Ephemeral });
      return;
    }

    const action = this.commandToAction(interaction.commandName);
    if (!action) return;

    const game = interaction.options.getString('game') ?? undefined;
    const roleIds = this.extractRoleIds(interaction);

    if (interaction.commandName === 'server-list') {
      await this.replyList(interaction);
      return;
    }

    if (!game) {
      if (action === 'status') {
        await this.replyAllStatuses(interaction, roleIds);
        return;
      }
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

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      if (action === 'start') {
        const result = await this.ecs.start(game);
        await interaction.editReply(
          (result.success ? '✅ ' : '❌ ') + result.message,
        );
      } else if (action === 'stop') {
        const result = await this.ecs.stop(game);
        await interaction.editReply(
          (result.success ? '✅ ' : '❌ ') + result.message,
        );
      } else {
        const status = await this.ecs.getStatus(game);
        await interaction.editReply(this.formatStatus(status));
      }
    } catch (err) {
      logger.error('Discord command execution failed', { err, command: interaction.commandName, game });
      await interaction.editReply('❌ Command failed. Check server logs.');
    }
  }

  private async handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'game') return;
    const games = this.config.getTfOutputs()?.game_names ?? [];
    const query = focused.value.toLowerCase();
    const matches = games
      .filter((g) => g.toLowerCase().includes(query))
      .slice(0, 25)
      .map((g) => ({ name: g, value: g }));
    await interaction.respond(matches).catch(() => undefined);
  }

  private async replyList(interaction: ChatInputCommandInteraction): Promise<void> {
    const games = this.config.getTfOutputs()?.game_names ?? [];
    if (!games.length) {
      await interaction.reply({ content: 'No games configured.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const statuses = await Promise.all(games.map((g) => this.ecs.getStatus(g)));
    const lines = statuses.map((s) => this.formatStatus(s));
    await interaction.editReply(lines.join('\n'));
  }

  private async replyAllStatuses(
    interaction: ChatInputCommandInteraction,
    _roleIds: string[],
  ): Promise<void> {
    await this.replyList(interaction);
  }

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

  private commandToAction(name: string): DiscordAction | null {
    switch (name) {
      case 'server-start': return 'start';
      case 'server-stop': return 'stop';
      case 'server-status': return 'status';
      case 'server-list': return 'status';
      default: return null;
    }
  }

  private extractRoleIds(interaction: ChatInputCommandInteraction): string[] {
    const member = interaction.member;
    if (!member) return [];
    const roles = (member as { roles?: unknown }).roles;
    if (!roles) return [];
    // GuildMember: roles is a GuildMemberRoleManager with a `cache` Collection
    const cache = (roles as { cache?: { keys?: () => IterableIterator<string> } }).cache;
    if (cache?.keys) return [...cache.keys()];
    // APIInteractionGuildMember: roles is string[]
    if (Array.isArray(roles)) return roles as string[];
    return [];
  }
}
