import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve, join } from 'path';

interface FileSeed {
  path: string;
  content?: string;
  content_base64?: string;
  mode?: string;
}

/** Payload sent by `aws_lambda_invocation.efs_seeder` in Terraform. */
interface SeederEvent {
  game: string;
  seeds: FileSeed[];
  /** The first volume's `container_path`, used to resolve in-container paths to EFS-relative paths. */
  container_path: string;
}

const MOUNT_POINT = '/mnt/efs';

/**
 * Strips the container_path prefix from a seed path and resolves it to an
 * absolute destination under MOUNT_POINT.  Throws on path-traversal attempts.
 */
function resolveDestination(seedPath: string, containerPath: string): string {
  const normalizedContainer = containerPath.replace(/\/$/, '');

  if (!seedPath.startsWith(normalizedContainer + '/') && seedPath !== normalizedContainer) {
    throw new Error(
      `Seed path "${seedPath}" does not start with container_path "${normalizedContainer}"`,
    );
  }

  const relative = seedPath.slice(normalizedContainer.length).replace(/^\//, '');
  const dest = resolve(join(MOUNT_POINT, relative));

  if (dest !== MOUNT_POINT && !dest.startsWith(MOUNT_POINT + '/')) {
    throw new Error(`Path traversal detected: "${seedPath}" resolves outside mount point`);
  }

  return dest;
}

export const handler = async (event: SeederEvent): Promise<void> => {
  const { game, seeds, container_path: containerPath } = event;

  console.log(`Seeding ${seeds.length} file(s) for game "${game}" (mount: ${MOUNT_POINT})`);

  for (const seed of seeds) {
    const dest = resolveDestination(seed.path, containerPath);

    let content: Buffer;
    if (seed.content_base64 !== undefined) {
      content = Buffer.from(seed.content_base64, 'base64');
    } else if (seed.content !== undefined) {
      content = Buffer.from(seed.content, 'utf8');
    } else {
      throw new Error(`Seed at path "${seed.path}" has neither content nor content_base64`);
    }

    mkdirSync(dirname(dest), { recursive: true });

    const mode = parseInt(seed.mode ?? '0644', 8);
    writeFileSync(dest, content, { flag: 'w', mode });

    console.log(`Wrote ${dest} (${content.length} bytes, mode ${seed.mode ?? '0644'})`);
  }

  console.log(`Done — ${seeds.length} file(s) seeded for game "${game}"`);
};
