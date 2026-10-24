/**
 * A single classifier's verdict on an input. `lang` is the canonical lowercase
 * language name (matching `normalizeLanguage()` output). `confidence` is on a
 * normalized 0–1 scale. `undefined` means the classifier abstained (input was
 * too short to score, init failed, or any other reason it cannot answer).
 */
export type ClassifierResult = { lang: string; confidence: number } | undefined;

export interface Classifier {
  readonly name: string;
  detect(input: string): ClassifierResult;
  /**
   * True when this classifier has a profile for the given target language.
   * Used by the decision pipeline to skip classifiers that cannot nominally
   * identify the target — including such a classifier biases the ensemble
   * toward TRANSLATE because every vote it casts must be "non-target."
   */
  supports(target: string): boolean;
}
