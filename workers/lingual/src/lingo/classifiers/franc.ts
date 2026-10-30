import { francAll } from 'franc-min';
import { normalizeLanguage } from '@pvtch/shared/languages';
import type { Classifier, ClassifierResult } from './types';

// franc-min does not export its supported-language set, so we mirror the
// codes carried by its data.js (extracted at implementation time). Update
// this list if the package's data file changes — verified by running the
// classifier's smoke test which probes a few representative inputs.
const FRANC_CODES: ReadonlyArray<string> = [
  'arb',
  'ari',
  'azj',
  'bel',
  'bho',
  'bic',
  'bos',
  'bul',
  'ceb',
  'ces',
  'ckb',
  'deu',
  'eng',
  'fra',
  'fuv',
  'hau',
  'hin',
  'hms',
  'hnj',
  'hrv',
  'hun',
  'ibo',
  'ilo',
  'ind',
  'ita',
  'jav',
  'kaz',
  'kin',
  'koi',
  'lic',
  'lin',
  'mad',
  'mag',
  'mai',
  'mar',
  'nld',
  'npi',
  'nya',
  'pbu',
  'pes',
  'plt',
  'pol',
  'por',
  'qug',
  'ron',
  'run',
  'rus',
  'skr',
  'som',
  'spa',
  'srp',
  'sun',
  'swe',
  'swh',
  'tgl',
  'tin',
  'tur',
  'ukr',
  'urd',
  'uzn',
  'vie',
  'yor',
  'zlm',
  'zul',
  'zyb',
];
const SUPPORTED_NAMES = new Set(
  FRANC_CODES.map((code) => normalizeLanguage(code))
);

// franc-min returns trigram-distance tuples sorted descending where the top
// result is normalized to 1.0. Confidence is derived from the gap between top
// and runner-up, then scaled by GAP_SCALE to bring it onto a roughly tinyld-
// comparable 0–1 range. Empirically, clean prose has gap ≈ 0.2–0.4 (related
// languages always trail close in trigram space, e.g. Scots and Dutch behind
// English), and a multiplier of 4 lands those cases above the skip threshold.
//
// francAll returns 'und' (undetermined) for inputs below its internal length
// minimum, which we treat as abstention.
const GAP_SCALE = 4;

export const francClassifier: Classifier = {
  name: 'franc-min',
  supports(target: string): boolean {
    return SUPPORTED_NAMES.has(normalizeLanguage(target));
  },
  detect(input: string): ClassifierResult {
    try {
      const results = francAll(input);
      const top = results[0];
      if (!top || top[0] === 'und') return undefined;
      const second = results[1]?.[1] ?? 0;
      const gap = top[1] - second;
      const confidence = Math.max(0, Math.min(1, gap * GAP_SCALE));
      return {
        lang: normalizeLanguage(top[0]),
        confidence,
      };
    } catch {
      return undefined;
    }
  },
};
