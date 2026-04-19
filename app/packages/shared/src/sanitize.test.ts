import { describe, it, expect } from 'vitest';
import { asString, asStringArray, isSafeGameKey, sanitizeGamePermission } from './sanitize.js';

describe('asString', () => {
  it('should return the string when the input is a string', () => {
    expect(asString('hello')).toBe('hello');
  });
  it('should return undefined when the input is not a string', () => {
    expect(asString(42)).toBeUndefined();
    expect(asString(null)).toBeUndefined();
    expect(asString(undefined)).toBeUndefined();
    expect(asString({})).toBeUndefined();
    expect(asString(['a'])).toBeUndefined();
  });
});

describe('asStringArray', () => {
  it('should keep only the string entries of an array and drop the rest', () => {
    expect(asStringArray(['a', 1, null, 'b', true, 'c'])).toEqual(['a', 'b', 'c']);
  });
  it('should return an empty array when the input is not an array', () => {
    expect(asStringArray('not-an-array')).toEqual([]);
    expect(asStringArray(null)).toEqual([]);
    expect(asStringArray(undefined)).toEqual([]);
    expect(asStringArray(42)).toEqual([]);
  });
});

describe('isSafeGameKey', () => {
  it('should accept normal game names', () => {
    expect(isSafeGameKey('palworld')).toBe(true);
    expect(isSafeGameKey('satisfactory')).toBe(true);
  });
  it('should reject prototype-pollution keys', () => {
    expect(isSafeGameKey('__proto__')).toBe(false);
    expect(isSafeGameKey('constructor')).toBe(false);
    expect(isSafeGameKey('prototype')).toBe(false);
  });
  it('should reject empty strings and non-strings', () => {
    expect(isSafeGameKey('')).toBe(false);
    expect(isSafeGameKey(42 as unknown as string)).toBe(false);
  });
});

describe('sanitizeGamePermission', () => {
  it('should return a well-typed permission from a valid input', () => {
    const result = sanitizeGamePermission({
      userIds: ['U1', 'U2'],
      roleIds: ['R1'],
      actions: ['start', 'stop'],
    });
    expect(result).toEqual({
      userIds: ['U1', 'U2'],
      roleIds: ['R1'],
      actions: ['start', 'stop'],
    });
  });
  it('should drop unknown actions from the input', () => {
    const result = sanitizeGamePermission({
      userIds: [],
      roleIds: [],
      actions: ['start', 'delete', 'status', 'nuclear_launch'],
    });
    expect(result.actions).toEqual(['start', 'status']);
  });
  it('should return safe defaults when the input is empty or malformed', () => {
    expect(sanitizeGamePermission(null)).toEqual({ userIds: [], roleIds: [], actions: [] });
    expect(sanitizeGamePermission('not an object')).toEqual({ userIds: [], roleIds: [], actions: [] });
    expect(sanitizeGamePermission({ userIds: 'not-an-array' })).toEqual({
      userIds: [],
      roleIds: [],
      actions: [],
    });
  });
  it('should drop non-string entries inside userIds / roleIds arrays', () => {
    const result = sanitizeGamePermission({
      userIds: ['U1', 42, null, 'U2'],
      roleIds: [true, 'R1'],
      actions: ['start'],
    });
    expect(result.userIds).toEqual(['U1', 'U2']);
    expect(result.roleIds).toEqual(['R1']);
  });
});
