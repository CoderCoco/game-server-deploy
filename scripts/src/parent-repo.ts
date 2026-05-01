import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { stdout as output } from 'node:process';

export class ParentRepo {
  constructor(
    readonly parentDir: string,
    readonly submoduleDir: string,
  ) {}

  get submoduleName(): string {
    return this.submoduleDir.split('/').pop() || 'game-server-deploy';
  }

  /**
   * Write `contents` to `<parentDir>/<relPath>`.
   * Returns 'skipped' if the file exists and `force` is false.
   */
  writeFile(relPath: string, contents: string, force = false): 'wrote' | 'skipped' | 'overwrote' {
    const fullPath = join(this.parentDir, relPath);
    if (existsSync(fullPath) && !force) return 'skipped';
    const existed = existsSync(fullPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, contents);
    return existed ? 'overwrote' : 'wrote';
  }

  reportFile(relPath: string, action: 'wrote' | 'skipped' | 'overwrote'): void {
    const tag = action === 'wrote' ? '  +' : action === 'overwrote' ? '  ~' : '  ·';
    const note = action === 'skipped' ? '  (exists — use --force to overwrite)' : '';
    output.write(`${tag} ${relPath}${note}\n`);
  }

  /** Walk up from `start` until a directory containing `.gitmodules` is found. */
  static detectRoot(start: string): string | null {
    let dir = resolve(start);
    while (true) {
      if (existsSync(join(dir, '.gitmodules'))) return dir;
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }

  /**
   * Best-effort guess of the submodule path inside the parent repo.
   * `scriptsDir` should point to the `scripts/` directory of the submodule.
   */
  static detectSubmodulePath(parentDir: string, scriptsDir: string): string {
    const submoduleRoot = dirname(scriptsDir);
    const rel = relative(parentDir, submoduleRoot);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel;

    const gm = join(parentDir, '.gitmodules');
    if (existsSync(gm)) {
      const m = readFileSync(gm, 'utf8').match(/path\s*=\s*(\S+)/);
      if (m) return m[1];
    }
    return 'game-server-deploy';
  }
}
