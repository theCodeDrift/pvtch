import { z } from 'zod';

import type { DetectorConfig } from './detector-v2';

/** `provider/model`, as OpenRouter lists it. */
export const modelId = z
  .string()
  .trim()
  .regex(/^[^\s/]+\/\S+$/);

/** Which models v2 uses. Production reads this from env; the dev harness
 * passes others to compare them. */
export interface V2Config {
  detectorApi: DetectorConfig['api'];
  detectorModel: string;
  translatorModel: string;
  /** Translate only at or below this probability that the message is entirely
   * in the target language. Scores are model-specific. */
  maxTargetProbability: number;
  detectorDisableThinking: boolean;
  translatorDisableThinking: boolean;
}

const v2Env = z.object({
  LINGUAL_V2_DETECTOR_API: z.enum(['decisions', 'chat']),
  LINGUAL_V2_DETECTOR_MODEL: modelId,
  LINGUAL_V2_TRANSLATOR_MODEL: modelId,
  LINGUAL_V2_MAX_TARGET_PROBABILITY: z.coerce.number().min(0).max(1),
  LINGUAL_V2_DISABLE_THINKING: z.enum(['true', 'false']),
});

/** The v2 config from `LINGUAL_V2_*` vars. Throws when one is invalid. */
export function v2ConfigFromEnv(env: Env): V2Config {
  const vars = v2Env.parse(env);
  const disableThinking = vars.LINGUAL_V2_DISABLE_THINKING === 'true';
  return {
    detectorApi: vars.LINGUAL_V2_DETECTOR_API,
    detectorModel: vars.LINGUAL_V2_DETECTOR_MODEL,
    translatorModel: vars.LINGUAL_V2_TRANSLATOR_MODEL,
    maxTargetProbability: vars.LINGUAL_V2_MAX_TARGET_PROBABILITY,
    detectorDisableThinking: disableThinking,
    translatorDisableThinking: disableThinking,
  };
}
