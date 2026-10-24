import { describe, it, expect } from 'vitest';
import { decide } from '../../src/lingo/decision';

// Corpus parallel to e2e/lingo.test.ts. The e2e tests exercise the LLM
// translator end-to-end; these tests exercise the pre-LLM `decide()` pipeline
// against the same inputs. They document expected behavior of the pipeline
// (which inputs short-circuit, which go to the LLM, which skip as gibberish)
// so a classifier-package upgrade or threshold tweak surfaces visible drift.
//
// Target language is English throughout.

interface CorpusCase {
  input: string;
  description: string;
  /** Expected decision action. */
  expected: 'TRANSLATE' | 'SKIP_GIBBERISH' | 'SKIP_TARGET' | 'SKIP_AMBIGUOUS';
  /** Optional looser assertion: any of these actions is acceptable. */
  acceptable?: ReadonlyArray<
    'TRANSLATE' | 'SKIP_GIBBERISH' | 'SKIP_TARGET' | 'SKIP_AMBIGUOUS'
  >;
}

const TARGET = 'English';

const corpus: CorpusCase[] = [
  {
    input: "Don't mind nanopanther, he's got a case of the drifties",
    description: 'plain English, long enough for classifiers',
    expected: 'SKIP_TARGET',
  },
  {
    input:
      'Added Quote 101: "I never interrupt Mommy-.. I mean Cortana" - @saintnoble [Halo: The Master Chief Collection] [11/02/2026]',
    description: 'English with @mention + heavy punctuation',
    // Heavy quotes/brackets/numbers drag tinyld's confidence way down, so
    // even though the language is unambiguously English the ensemble lands
    // on SKIP_AMBIGUOUS. Behaviorally identical to SKIP_TARGET (no LLM
    // call); diagnostically less decisive.
    expected: 'SKIP_AMBIGUOUS',
    acceptable: ['SKIP_AMBIGUOUS', 'SKIP_TARGET'],
  },
  {
    input: 'galing na curlyg5Wow',
    description: 'Tagalog with emote — emote strip leaves under threshold',
    expected: 'SKIP_GIBBERISH',
  },
  {
    input: 'kumusta na tayo, @ohaiDrifty ? f0x64Marbie',
    description:
      'Tagalog with mention + emote stripped — Latin script, short cleaned',
    // After stripping "@ohaiDrifty" and "f0x64Marbie": "kumusta na tayo, ?"
    // Could go either way — classifiers may detect Tagalog confidently, or
    // be ambiguous on the short string.
    expected: 'TRANSLATE',
    acceptable: ['TRANSLATE', 'SKIP_AMBIGUOUS'],
  },
  {
    input: "I shouldn't be translated thecod67Lol",
    description: 'English with emote stripped',
    expected: 'SKIP_TARGET',
  },
  {
    input: 'haiiiiii chelle!',
    description: 'stream-chat reaction with repeated-character run',
    // Preprocessing collapses "haiiiiii" → "haii", taking cleaned length
    // below the 16-grapheme gate. Catches the class of reaction noise
    // that classifiers were misclassifying as confident non-English.
    expected: 'SKIP_GIBBERISH',
  },
  {
    input: "내 황홀에 취해, you can't look away",
    description: 'Korean + English mixed — Latin script present, not disjoint',
    // The Latin portion is in the input, so not script-disjoint. Classifiers
    // see both scripts; result depends on which dominates the n-gram count.
    expected: 'TRANSLATE',
    acceptable: ['TRANSLATE', 'SKIP_AMBIGUOUS'],
  },
  {
    input:
      'Yeah relaunching provides completely different data. Things are randomized to ensure you sstay anonymous with each browser launch in Mullvad',
    description: 'long plain English',
    expected: 'SKIP_TARGET',
  },
  {
    input: 'I should get 2/3rds of that payout, yeah?',
    description: 'plain English with digits and punctuation',
    // franc-min mis-tops this one (says Hmong Njua) so the two classifiers
    // disagree on which non-target language even though tinyld is correct.
    // Result is SKIP_AMBIGUOUS — still no LLM call, just less decisive.
    expected: 'SKIP_AMBIGUOUS',
    acceptable: ['SKIP_AMBIGUOUS', 'SKIP_TARGET'],
  },
  {
    input: 'heya kaph',
    description: 'short English — under gibberish threshold',
    expected: 'SKIP_GIBBERISH',
  },
  {
    input: 'heheheh',
    description: 'reaction noise, under gibberish threshold',
    expected: 'SKIP_GIBBERISH',
  },
  {
    input: 'atissssssssssaaaaa',
    description:
      'reaction word with long consonant/vowel runs (regression: was being mistranslated to "mango" before repeat-collapse was added)',
    expected: 'SKIP_GIBBERISH',
  },
  {
    input: '안녕하세요 친구야 어떻게 지내세요',
    description: 'pure Korean — script-disjoint short-circuit',
    expected: 'TRANSLATE',
  },
  {
    input: 'Привет мир как у тебя дела',
    description: 'pure Russian — script-disjoint short-circuit',
    expected: 'TRANSLATE',
  },
  {
    input: 'こんにちは世界元気ですか今日もよろしくお願いします',
    description: 'pure Japanese — script-disjoint short-circuit',
    expected: 'TRANSLATE',
  },
];

describe('corpus: decide() against e2e lingo fixtures', () => {
  for (const item of corpus) {
    it(`${item.expected.padEnd(20)} | ${item.description}`, () => {
      const d = decide(item.input, TARGET);
      const acceptable = item.acceptable ?? [item.expected];
      expect(acceptable).toContain(d.action);
    });
  }
});
