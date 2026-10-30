import { describe, it, expect } from 'vitest';
import { detectScripts, isScriptDisjoint } from '../../src/lingo/script';

describe('detectScripts', () => {
  it('detects Latin', () => {
    expect(detectScripts('hello world')).toEqual(new Set(['Latin']));
  });

  it('detects Hangul', () => {
    expect(detectScripts('안녕하세요')).toEqual(new Set(['Hangul']));
  });

  it('detects Cyrillic', () => {
    expect(detectScripts('Привет мир')).toEqual(new Set(['Cyrillic']));
  });

  it('detects Hiragana and Han together for Japanese', () => {
    const scripts = detectScripts('こんにちは世界');
    expect(scripts.has('Hiragana')).toBe(true);
    expect(scripts.has('Han')).toBe(true);
  });

  it('detects mixed Latin + Hangul', () => {
    expect(detectScripts('hello 안녕')).toEqual(new Set(['Latin', 'Hangul']));
  });

  it('returns empty set for digits and punctuation only', () => {
    expect(detectScripts('123 !@# ...')).toEqual(new Set());
  });
});

describe('isScriptDisjoint', () => {
  it('returns true when Hangul input has English target', () => {
    expect(isScriptDisjoint(new Set(['Hangul']), 'english')).toBe(true);
  });

  it('returns false when Latin input has English target', () => {
    expect(isScriptDisjoint(new Set(['Latin']), 'english')).toBe(false);
  });

  it('returns false when input shares one script with target (Japanese)', () => {
    // Japanese uses Hiragana + Katakana + Han. Input with Han only still
    // shares a script with the target language.
    expect(isScriptDisjoint(new Set(['Han']), 'japanese')).toBe(false);
  });

  it('returns true when Korean target receives Latin-only input', () => {
    expect(isScriptDisjoint(new Set(['Latin']), 'korean')).toBe(true);
  });

  it('returns false for empty input scripts (no signal)', () => {
    // Empty script set = digits/punctuation only = no detection signal,
    // we don't want to flip to TRANSLATE based on that
    expect(isScriptDisjoint(new Set(), 'english')).toBe(false);
  });

  it('returns false when at least one script matches target', () => {
    // Mixed Latin + Hangul against English target: Latin matches, so not disjoint
    expect(isScriptDisjoint(new Set(['Latin', 'Hangul']), 'english')).toBe(
      false
    );
  });
});
