import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_TARGET_LANGUAGES,
  findSupportedTargetLanguage,
  isSupportedTargetLanguage,
} from '../src/supported-languages';

describe('SUPPORTED_TARGET_LANGUAGES', () => {
  it('contains entries from both tiers', () => {
    const tiers = new Set(SUPPORTED_TARGET_LANGUAGES.map((l) => l.tier));
    expect(tiers.has('ensemble')).toBe(true);
    expect(tiers.has('llm-only')).toBe(true);
  });

  it('is sorted by name', () => {
    const names = SUPPORTED_TARGET_LANGUAGES.map((l) => l.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it('includes English in the ensemble tier', () => {
    const eng = SUPPORTED_TARGET_LANGUAGES.find((l) => l.name === 'english');
    expect(eng).toBeDefined();
    expect(eng?.tier).toBe('ensemble');
  });

  it('includes Korean as an llm-only target', () => {
    const kor = SUPPORTED_TARGET_LANGUAGES.find((l) => l.name === 'korean');
    expect(kor).toBeDefined();
    expect(kor?.tier).toBe('llm-only');
  });
});

describe('findSupportedTargetLanguage', () => {
  it('resolves by full name', () => {
    expect(findSupportedTargetLanguage('English')?.iso639_1).toBe('en');
  });

  it('resolves by ISO 639-1 code', () => {
    expect(findSupportedTargetLanguage('en')?.name).toBe('english');
  });

  it('resolves by ISO 639-3 code', () => {
    expect(findSupportedTargetLanguage('eng')?.name).toBe('english');
  });

  it('is case-insensitive', () => {
    expect(findSupportedTargetLanguage('KOREAN')?.iso639_3).toBe('kor');
  });

  it('trims whitespace', () => {
    expect(findSupportedTargetLanguage('  spanish  ')?.iso639_1).toBe('es');
  });

  it('returns undefined for unsupported languages', () => {
    // Klingon is in the LANGUAGES universe (it's in tinyld) but deliberately
    // not on the supported-target list.
    expect(findSupportedTargetLanguage('klingon')).toBeUndefined();
    expect(findSupportedTargetLanguage('tlh')).toBeUndefined();
  });

  it('returns undefined for garbage input', () => {
    expect(findSupportedTargetLanguage('asdfqwer')).toBeUndefined();
    expect(findSupportedTargetLanguage('')).toBeUndefined();
  });
});

describe('isSupportedTargetLanguage', () => {
  it('returns true for a supported entry', () => {
    expect(isSupportedTargetLanguage('english')).toBe(true);
    expect(isSupportedTargetLanguage('en')).toBe(true);
    expect(isSupportedTargetLanguage('eng')).toBe(true);
  });

  it('returns false for an unsupported entry', () => {
    expect(isSupportedTargetLanguage('klingon')).toBe(false);
  });
});
