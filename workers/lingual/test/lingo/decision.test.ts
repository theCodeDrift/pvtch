import { describe, it, expect } from 'vitest';
import { decide } from '../../src/lingo/decision';
import type {
  Classifier,
  ClassifierResult,
} from '../../src/lingo/classifiers/types';

function mockClassifier(name: string, result: ClassifierResult): Classifier {
  return { name, detect: () => result, supports: () => true };
}

const ENG_HIGH = mockClassifier('a', { lang: 'english', confidence: 0.95 });
const ENG_LOW = mockClassifier('a-low', { lang: 'english', confidence: 0.55 });
const SPA_HIGH = mockClassifier('b', { lang: 'spanish', confidence: 0.92 });
const SPA_MEH = mockClassifier('b-meh', { lang: 'spanish', confidence: 0.6 });
const KOR_HIGH = mockClassifier('c', { lang: 'korean', confidence: 0.99 });
const ABSTAIN: Classifier = {
  name: 'abs',
  // eslint-disable-next-line unicorn/no-useless-undefined
  detect: () => undefined,
  supports: () => true,
};

// Padding to make the cleaned input pass the 16-grapheme gate.
const PAD = 'lorem ipsum dolor sit amet';

describe('decide() — gates', () => {
  it('SKIP_GIBBERISH when cleaned length is below threshold', () => {
    const d = decide('short', 'english', [ENG_HIGH, ENG_HIGH]);
    expect(d.action).toBe('SKIP_GIBBERISH');
  });

  it('SKIP_GIBBERISH after preprocessing strips below threshold', () => {
    const d = decide('@bob PogChamp LULW', 'english', [ENG_HIGH, ENG_HIGH]);
    expect(d.action).toBe('SKIP_GIBBERISH');
    expect(d.cleaned).toBe('');
  });

  it('TRANSLATE when script is disjoint from target (Korean input, English target)', () => {
    const d = decide('안녕하세요 친구 어떻게 지내세요', 'english', [
      ABSTAIN,
      ABSTAIN,
    ]);
    expect(d.action).toBe('TRANSLATE');
    expect(d.reason).toContain('script disjoint');
    // Script-disjoint short-circuit fires before classifiers, so no votes.
    expect(d.votes).toEqual([]);
  });
});

describe('decide() — ensemble rule', () => {
  it('TRANSLATE when one classifier is confident in non-target (K=1)', () => {
    const d = decide(PAD, 'english', [SPA_HIGH, ENG_HIGH]);
    expect(d.action).toBe('TRANSLATE');
    expect(d.reason).toContain('non-target');
  });

  it('TRANSLATE when only one classifier votes confidently non-target, other abstains', () => {
    const d = decide(PAD, 'english', [SPA_HIGH, ABSTAIN]);
    expect(d.action).toBe('TRANSLATE');
  });

  it('SKIP_TARGET when both classifiers confidently say target', () => {
    const d = decide(PAD, 'english', [ENG_HIGH, ENG_HIGH]);
    expect(d.action).toBe('SKIP_TARGET');
  });

  it('SKIP_AMBIGUOUS when only one classifier confidently says target', () => {
    const d = decide(PAD, 'english', [ENG_HIGH, ABSTAIN]);
    expect(d.action).toBe('SKIP_AMBIGUOUS');
  });

  it('SKIP_AMBIGUOUS when both classifiers vote target but only one passes τ_skip', () => {
    const d = decide(PAD, 'english', [ENG_HIGH, ENG_LOW]);
    expect(d.action).toBe('SKIP_AMBIGUOUS');
  });

  it('SKIP_AMBIGUOUS when both vote non-target but neither passes τ_translate', () => {
    const lowSpa = mockClassifier('b', {
      lang: 'spanish',
      confidence: 0.4,
    });
    const lowFre = mockClassifier('c', {
      lang: 'french',
      confidence: 0.4,
    });
    const d = decide(PAD, 'english', [lowSpa, lowFre]);
    expect(d.action).toBe('SKIP_AMBIGUOUS');
  });

  it('SKIP_AMBIGUOUS when all classifiers abstain', () => {
    const d = decide(PAD, 'english', [ABSTAIN, ABSTAIN]);
    expect(d.action).toBe('SKIP_AMBIGUOUS');
  });

  it('confident non-target wins over confident target (K=1 priority)', () => {
    const d = decide(PAD, 'english', [SPA_HIGH, ENG_HIGH]);
    expect(d.action).toBe('TRANSLATE');
  });

  it('Korean confident vote vs English target triggers TRANSLATE', () => {
    const d = decide(PAD, 'english', [KOR_HIGH, ABSTAIN]);
    expect(d.action).toBe('TRANSLATE');
  });

  it('excludes classifiers that do not support the target', () => {
    const notSupportsEnglish: Classifier = {
      name: 'no-eng',
      detect: () => ({ lang: 'french', confidence: 0.99 }),
      supports: (target) => target !== 'english',
    };
    // Without filtering, this classifier would cast a confident non-target
    // vote (french@0.99) and force TRANSLATE. With filtering, it's excluded
    // and only ENG_HIGH votes — which alone can't reach K=2 → SKIP_AMBIGUOUS.
    const d = decide(PAD, 'english', [notSupportsEnglish, ENG_HIGH]);
    expect(d.action).toBe('SKIP_AMBIGUOUS');
    expect(d.votes.map((v) => v.classifier)).toEqual(['a']);
  });

  it('forces TRANSLATE when no classifier supports the target', () => {
    const cantHelp: Classifier = {
      name: 'irrelevant',
      detect: () => ({ lang: 'french', confidence: 0.99 }),
      supports: () => false,
    };
    const d = decide(PAD, 'catalan', [cantHelp, cantHelp]);
    expect(d.action).toBe('TRANSLATE');
    expect(d.reason).toContain('no classifier supports target');
    expect(d.votes).toEqual([]);
  });

  it('records cleaned input, length, scripts, and votes', () => {
    const d = decide(PAD, 'english', [SPA_MEH, ENG_HIGH]);
    expect(d.cleaned).toBe(PAD);
    expect(d.cleanedLength).toBe(PAD.length);
    expect(d.scripts).toContain('Latin');
    expect(d.votes).toHaveLength(2);
    expect(d.votes[0]).toEqual({
      classifier: 'b-meh',
      result: { lang: 'spanish', confidence: 0.6 },
    });
  });
});
