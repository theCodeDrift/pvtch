import { detectAll, supportedLanguages } from 'tinyld/heavy';
import { normalizeLanguage } from '@pvtch/shared/languages';
import type { Classifier, ClassifierResult } from './types';

const SUPPORTED_NAMES = new Set(
  supportedLanguages.map((code) => normalizeLanguage(code))
);

export const tinyldClassifier: Classifier = {
  name: 'tinyld',
  supports(target: string): boolean {
    return SUPPORTED_NAMES.has(normalizeLanguage(target));
  },
  detect(input: string): ClassifierResult {
    try {
      const results = detectAll(input);
      const top = results[0];
      if (!top || !top.lang) return undefined;
      return {
        lang: normalizeLanguage(top.lang),
        confidence: top.accuracy,
      };
    } catch {
      return undefined;
    }
  },
};
