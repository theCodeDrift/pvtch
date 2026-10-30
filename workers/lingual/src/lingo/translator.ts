// Bot copy of workers/core/app/lib/translator.ts; changes independently.

import { z } from 'zod';
import { normalizeLanguage } from '@pvtch/shared/languages';

const MODEL = '@cf/qwen/qwen3-30b-a3b-fp8' as const;

const LANGUAGE_TRANSLATOR = `
You are a translation assistant.

## Inputs
1. The "target language" that the user wants the text translated into
2. The "input text" that needs to be translated

## Instructions
1. Identify the language of the input text
2. Capture the ISO 639-3 three-letter code for the detected language
2. Translate the input text into the requested target language

Rules:
- Make an informed attempt to identify the target language
- If the "input text" is already in the "target language", return it as-is with the detected language matching the target language
- Preserve @usernames exactly as-is. They are treated as someone's name
- Ignore kaomoji, Twitch emotes, emoticons, and smileys
- Prefer natural, fluent translations over literal word-for-word
- Return the base language name without regional variants (e.g. "Portuguese" not "Brazilian Portuguese", "Chinese" not "Mandarin Chinese")
- IMPORTANT: If the input text contains ONLY Latin script characters (A-Z letters), it CANNOT be Japanese, Korean, Chinese, Arabic, Thai, or any language that primarily uses a non-Latin writing system. These languages have their own scripts (e.g. 日本語, 한국어, 中文). Latin-only text with informal spelling, elongated letters (e.g. "haiiiiii"), or slang is English or another Latin-script language, not a phonetic transliteration

## Output
Your output should be JSON formatted as follows:

\`\`\`
{
  "detected": "The base language name (e.g. English, Korean, Tagalog, Spanish)",
  "detectedCode": "The ISO 639-3 code (e.g. eng, kor, tgl, spa)",
  "translation": "The translated text"
}
\`\`\`
`.trim();

const LANGUAGE_TRANSLATOR_SCHEMA = z.object({
  detected: z.string(),
  detectedCode: z.string(),
  translation: z.string(),
});

const createConversation = ({
  targetLanguage,
  input,
}: {
  targetLanguage: string;
  input: string;
}): AiModels[typeof MODEL]['inputs'] => {
  return {
    response_format: {
      type: 'json_schema',
      json_schema: LANGUAGE_TRANSLATOR_SCHEMA.toJSONSchema(),
    },
    messages: [
      {
        role: 'system',
        content: LANGUAGE_TRANSLATOR,
      },
      {
        role: 'assistant',
        content: 'What is the requested target language?',
      },
      {
        role: 'user',
        content: targetLanguage,
      },
      {
        role: 'assistant',
        content: `What text should I translate?`,
      },
      {
        role: 'user',
        content: input,
      },
    ],
  };
};

type TranslateOptions = {
  env: Env;
  targetLanguage: string;
};

type TranslationResponse =
  | {
      success: true;
      data: z.infer<typeof LANGUAGE_TRANSLATOR_SCHEMA>;
      raw?: string;
    }
  | {
      success: false;
      error: string;
      details?: unknown;
      raw?: string;
    };

export const translate = async (
  input: string,
  options: TranslateOptions
): Promise<TranslationResponse> => {
  const { env, targetLanguage } = options;
  const response = (await env.AI.run(
    '@cf/qwen/qwen3-30b-a3b-fp8',
    createConversation({
      targetLanguage,
      input,
    })
  )) as Ai_Cf_Qwen_Qwen3_30B_A3B_Fp8_Chat_Completion_Response;

  // content location
  const rawData = response.choices?.[0]?.message?.content;
  let data: z.infer<typeof LANGUAGE_TRANSLATOR_SCHEMA> | undefined;

  try {
    data = LANGUAGE_TRANSLATOR_SCHEMA.parse(JSON.parse(rawData ?? ''));
  } catch (error) {
    return {
      success: false,
      error: 'Failed to parse translator response',
      details: error,
      raw: rawData,
    };
  }

  return {
    success: true,
    data,
    raw: rawData,
  };
};

/** Returns true if the input contains only Latin script characters (plus digits, punctuation, whitespace). */
const isLatinOnly = (input: string): boolean =>
  /^[\p{Script=Latin}\p{N}\p{P}\p{Z}\p{S}\p{M}]+$/u.test(input);

/** ISO 639-3 codes for languages that primarily use non-Latin writing systems. */
const NON_LATIN_SCRIPT_LANGUAGES = new Set([
  'ara', // Arabic
  'ben', // Bengali
  'mya', // Burmese
  'zho', // Chinese
  'kat', // Georgian
  'ell', // Greek
  'guj', // Gujarati
  'heb', // Hebrew
  'hin', // Hindi
  'jpn', // Japanese
  'kan', // Kannada
  'kas', // Kashmiri
  'khm', // Central Khmer
  'kor', // Korean
  'lao', // Lao
  'mal', // Malayalam
  'mar', // Marathi
  'mon', // Mongolian
  'nep', // Nepali
  'ori', // Oriya
  'pan', // Panjabi
  'fas', // Persian
  'pus', // Pashto
  'rus', // Russian
  'san', // Sanskrit
  'sin', // Sinhala
  'tam', // Tamil
  'tel', // Telugu
  'tha', // Thai
  'bod', // Tibetan
  'tir', // Tigrinya
  'ukr', // Ukrainian
  'urd', // Urdu
  'yid', // Yiddish
]);

/** Returns true if the language code corresponds to a non-Latin writing system. */
const isNonLatinScriptLanguage = (code: string): boolean =>
  NON_LATIN_SCRIPT_LANGUAGES.has(code.toLowerCase());

export const isSameLanguage = (
  language: string,
  input: string,
  translationResponse: TranslationResponse
): boolean => {
  if (!translationResponse.success) {
    return true;
  }

  const target = normalizeLanguage(language);
  const detectedByName = normalizeLanguage(translationResponse.data.detected);
  const detectedByCode = normalizeLanguage(
    translationResponse.data.detectedCode
  );

  // Compare normalized names: handles "en" vs "eng" vs "English" → all become "english"
  if (target === detectedByName || target === detectedByCode) {
    return true;
  }

  // Script mismatch: if the input is entirely Latin script but the detected
  // language uses a non-Latin writing system, the detection is wrong.
  // e.g. "heya kaph" detected as Korean, "heheheh" detected as Korean
  if (
    isLatinOnly(input) &&
    isNonLatinScriptLanguage(translationResponse.data.detectedCode)
  ) {
    return true;
  }

  // If the translation is identical to the input, there's nothing to show
  if (
    translationResponse.data.translation.trim().toLocaleLowerCase() ===
    input.trim().toLocaleLowerCase()
  ) {
    return true;
  }

  return false;
};
