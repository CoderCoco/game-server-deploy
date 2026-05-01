import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

/** Encapsulates path detection and .gitmodules queries for a parent repo directory. */
export class ParentRepo {
  constructor(readonly dir: string) {}

  exists(): boolean {
    return existsSync(this.dir) && statSync(this.dir).isDirectory();
  }

  /**
   * Best-effort guess of the submodule path relative to this parent repo.
   * Checks the script's own location first (fast path), then falls back to
   * parsing .gitmodules.
   */
  detectSubmodulePath(scriptDir: string): string {
    const submoduleRoot = dirname(scriptDir);
    const rel = relative(this.dir, submoduleRoot);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel;

    const gm = join(this.dir, '.gitmodules');
    if (existsSync(gm)) {
      const m = readFileSync(gm, 'utf8').match(/path\s*=\s*(\S+)/);
      if (m) return m[1];
    }
    return 'game-server-deploy';
  }

  /** Whether a given relative submodule path is registered in .gitmodules. */
  hasSubmodule(submoduleDir: string): boolean {
    const gm = join(this.dir, '.gitmodules');
    if (!existsSync(gm)) return false;
    return readFileSync(gm, 'utf8').includes(submoduleDir);
  }
}

/** Walk up from `start` until a directory containing `.gitmodules` is found. */
export function findParentRepoRoot(start: string): string | null {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, '.gitmodules'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
