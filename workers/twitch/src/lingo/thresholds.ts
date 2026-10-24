// Calibration knobs for the local language detection pipeline. These are
// initial guesses; tune from corpus and user-reported translation cases.

/** Minimum cleaned grapheme length below which we treat input as gibberish. */
export const GIBBERISH_LENGTH = 16;

/**
 * Confidence threshold above which a classifier vote for a non-target language
 * is decisive enough to earn an LLM translation call (K=1 translate rule).
 */
export const TAU_TRANSLATE = 0.65;

/**
 * Confidence threshold above which a classifier vote for the target language
 * counts toward the "already in target language" skip decision (K=2 skip rule).
 */
export const TAU_SKIP = 0.85;
