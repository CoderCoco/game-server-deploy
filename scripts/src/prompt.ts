import { createInterface, type Interface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export interface IPrompter {
  ask(label: string, def?: string): Promise<string>;
  askBool(label: string, def: boolean): Promise<boolean>;
  /** Loops until a non-empty value is provided. */
  askRequired(label: string, def?: string): Promise<string>;
  close(): void;
}

export class ReadlinePrompter implements IPrompter {
  private readonly rl: Interface;

  constructor() {
    this.rl = createInterface({ input, output });
  }

  async ask(label: string, def?: string): Promise<string> {
    const suffix = def === undefined ? ': ' : ` [${def}]: `;
    const raw = (await this.rl.question(label + suffix)).trim();
    return raw || def || '';
  }

  async askBool(label: string, def: boolean): Promise<boolean> {
    const hint = def ? 'Y/n' : 'y/N';
    const raw = (await this.rl.question(`${label} (${hint}): `)).trim().toLowerCase();
    if (!raw) return def;
    return raw.startsWith('y');
  }

  async askRequired(label: string, def?: string): Promise<string> {
    while (true) {
      const v = await this.ask(label, def);
      if (v) return v;
      output.write('  ↳ a value is required.\n');
    }
  }

  close(): void {
    this.rl.close();
  }
}
