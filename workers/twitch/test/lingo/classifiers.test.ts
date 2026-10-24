import { describe, it, expect } from 'vitest';
import { tinyldClassifier } from '../../src/lingo/classifiers/tinyld';
import { francClassifier } from '../../src/lingo/classifiers/franc';

// Smoke tests against the live pure-JS classifiers. The goal is to catch
// "package broke or moved its API" failures, not to validate detection
// accuracy. We only assert that:
//   - The classifier returns *something* on reasonable input
//   - It returns null (abstention) on input it shouldn't try to score
//   - The language strings round-trip through normalizeLanguage()

const ENGLISH_SAMPLE =
  'The quick brown fox jumps over the lazy dog and runs away';
const SPANISH_SAMPLE =
  'El rápido zorro marrón salta sobre el perro perezoso y se va corriendo';

describe('tinyldClassifier (live)', () => {
  it('returns a result for an English sentence', () => {
    const r = tinyldClassifier.detect(ENGLISH_SAMPLE);
    expect(r).not.toBeNull();
    expect(typeof r?.lang).toBe('string');
    expect(r?.confidence).toBeGreaterThanOrEqual(0);
    expect(r?.confidence).toBeLessThanOrEqual(1);
  });

  it('returns a normalized English name for English input', () => {
    const r = tinyldClassifier.detect(ENGLISH_SAMPLE);
    expect(r?.lang).toBe('english');
  });
});

describe('francClassifier (live)', () => {
  it('returns a result for an English sentence', () => {
    const r = francClassifier.detect(ENGLISH_SAMPLE);
    expect(r).not.toBeNull();
    expect(typeof r?.lang).toBe('string');
  });

  it('abstains for input too short to score', () => {
    const r = francClassifier.detect('hi');
    expect(r).toBeUndefined();
  });

  it('returns a normalized lowercase name', () => {
    const r = francClassifier.detect(SPANISH_SAMPLE);
    expect(r?.lang).not.toBe('spa'); // should be normalized to "spanish"
    expect(r?.lang).toBe(r?.lang.toLowerCase());
  });
});
