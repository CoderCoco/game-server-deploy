import { describe, it, expect } from 'vitest';
import { formatGameStatus } from './formatStatus.js';

describe('formatGameStatus', () => {
  it('should render running state with a green emoji and the hostname', () => {
    const line = formatGameStatus({ game: 'palworld', state: 'running', hostname: 'palworld.example.com' });
    expect(line).toBe('🟢 **palworld**: running — `palworld.example.com`');
  });

  it('should fall back to the public IP when no hostname is present', () => {
    const line = formatGameStatus({ game: 'palworld', state: 'running', publicIp: '1.2.3.4' });
    expect(line).toBe('🟢 **palworld**: running — `1.2.3.4`');
  });

  it('should render starting state with a yellow emoji and no address', () => {
    const line = formatGameStatus({ game: 'palworld', state: 'starting' });
    expect(line).toBe('🟡 **palworld**: starting');
  });

  it('should render stopped state with a black emoji and no address', () => {
    const line = formatGameStatus({ game: 'palworld', state: 'stopped' });
    expect(line).toBe('⚫ **palworld**: stopped');
  });

  it('should render error state with a warning emoji', () => {
    const line = formatGameStatus({ game: 'palworld', state: 'error', message: 'boom' });
    expect(line).toBe('⚠️ **palworld**: error');
  });

  it('should render not_deployed with the warning emoji since there is no task to describe', () => {
    const line = formatGameStatus({ game: 'palworld', state: 'not_deployed' });
    expect(line).toBe('⚠️ **palworld**: not_deployed');
  });

  it('should prefer hostname over publicIp when both are present', () => {
    const line = formatGameStatus({
      game: 'palworld',
      state: 'running',
      hostname: 'palworld.example.com',
      publicIp: '1.2.3.4',
    });
    expect(line).toContain('palworld.example.com');
    expect(line).not.toContain('1.2.3.4');
  });
});
