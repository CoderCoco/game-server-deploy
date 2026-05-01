import { describe, it, expect } from 'vitest';
import { isValidProjectName, isValidRegion, isValidDomain } from '../src/validate.ts';

describe('isValidProjectName', () => {
  it('should accept lowercase letters and dashes', () => {
    expect(isValidProjectName('game-servers')).toBe(true);
  });

  it('should accept names with digits', () => {
    expect(isValidProjectName('my-games-01')).toBe(true);
  });

  it('should reject names with uppercase letters', () => {
    expect(isValidProjectName('GameServers')).toBe(false);
  });

  it('should reject names that start with a dash', () => {
    expect(isValidProjectName('-game')).toBe(false);
  });

  it('should reject names that are too short', () => {
    expect(isValidProjectName('ab')).toBe(false);
  });

  it('should reject names with underscores', () => {
    expect(isValidProjectName('game_servers')).toBe(false);
  });
});

describe('isValidRegion', () => {
  it('should accept standard AWS region strings', () => {
    expect(isValidRegion('us-east-1')).toBe(true);
    expect(isValidRegion('eu-west-2')).toBe(true);
    expect(isValidRegion('ap-southeast-1')).toBe(true);
  });

  it('should reject plain region names without a digit suffix', () => {
    expect(isValidRegion('us-east')).toBe(false);
  });

  it('should reject empty strings', () => {
    expect(isValidRegion('')).toBe(false);
  });
});

describe('isValidDomain', () => {
  it('should accept standard domain names', () => {
    expect(isValidDomain('example.com')).toBe(true);
    expect(isValidDomain('games.example.co.uk')).toBe(true);
  });

  it('should reject single-label names with no dot', () => {
    expect(isValidDomain('localhost')).toBe(false);
  });

  it('should reject domains starting with a dash', () => {
    expect(isValidDomain('-example.com')).toBe(false);
  });

  it('should reject empty strings', () => {
    expect(isValidDomain('')).toBe(false);
  });
});
