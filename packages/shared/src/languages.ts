/**
 * ISO 639 language code mappings (639-1 and 639-3 only).
 *
 * ISO 639-3 supersedes 639-2. Each entry maps a two-letter ISO 639-1 code
 * to its three-letter ISO 639-3 code and English language name.
 *
 * Only languages with an ISO 639-1 code are included since these are the
 * most commonly spoken languages and the ones users are likely to configure.
 *
 * Source: Library of Congress ISO 639-2 code list + ISO 639-3 mappings
 * https://www.loc.gov/standards/iso639-2/php/code_list.php
 */

export interface LanguageEntry {
  name: string;
  iso639_1: string;
  iso639_3: string;
}

export const LANGUAGES: LanguageEntry[] = [
  { name: 'afar', iso639_1: 'aa', iso639_3: 'aar' },
  { name: 'abkhazian', iso639_1: 'ab', iso639_3: 'abk' },
  { name: 'afrikaans', iso639_1: 'af', iso639_3: 'afr' },
  { name: 'akan', iso639_1: 'ak', iso639_3: 'aka' },
  { name: 'albanian', iso639_1: 'sq', iso639_3: 'sqi' },
  { name: 'amharic', iso639_1: 'am', iso639_3: 'amh' },
  { name: 'arabic', iso639_1: 'ar', iso639_3: 'ara' },
  { name: 'aragonese', iso639_1: 'an', iso639_3: 'arg' },
  { name: 'armenian', iso639_1: 'hy', iso639_3: 'hye' },
  { name: 'assamese', iso639_1: 'as', iso639_3: 'asm' },
  { name: 'avaric', iso639_1: 'av', iso639_3: 'ava' },
  { name: 'avestan', iso639_1: 'ae', iso639_3: 'ave' },
  { name: 'aymara', iso639_1: 'ay', iso639_3: 'aym' },
  { name: 'azerbaijani', iso639_1: 'az', iso639_3: 'aze' },
  { name: 'bashkir', iso639_1: 'ba', iso639_3: 'bak' },
  { name: 'bambara', iso639_1: 'bm', iso639_3: 'bam' },
  { name: 'basque', iso639_1: 'eu', iso639_3: 'eus' },
  { name: 'belarusian', iso639_1: 'be', iso639_3: 'bel' },
  { name: 'bengali', iso639_1: 'bn', iso639_3: 'ben' },
  { name: 'bislama', iso639_1: 'bi', iso639_3: 'bis' },
  { name: 'tibetan', iso639_1: 'bo', iso639_3: 'bod' },
  { name: 'bosnian', iso639_1: 'bs', iso639_3: 'bos' },
  { name: 'breton', iso639_1: 'br', iso639_3: 'bre' },
  { name: 'bulgarian', iso639_1: 'bg', iso639_3: 'bul' },
  { name: 'burmese', iso639_1: 'my', iso639_3: 'mya' },
  { name: 'catalan', iso639_1: 'ca', iso639_3: 'cat' },
  { name: 'czech', iso639_1: 'cs', iso639_3: 'ces' },
  { name: 'chamorro', iso639_1: 'ch', iso639_3: 'cha' },
  { name: 'chechen', iso639_1: 'ce', iso639_3: 'che' },
  { name: 'chinese', iso639_1: 'zh', iso639_3: 'zho' },
  { name: 'church slavic', iso639_1: 'cu', iso639_3: 'chu' },
  { name: 'chuvash', iso639_1: 'cv', iso639_3: 'chv' },
  { name: 'cornish', iso639_1: 'kw', iso639_3: 'cor' },
  { name: 'corsican', iso639_1: 'co', iso639_3: 'cos' },
  { name: 'cree', iso639_1: 'cr', iso639_3: 'cre' },
  { name: 'welsh', iso639_1: 'cy', iso639_3: 'cym' },
  { name: 'danish', iso639_1: 'da', iso639_3: 'dan' },
  { name: 'german', iso639_1: 'de', iso639_3: 'deu' },
  { name: 'divehi', iso639_1: 'dv', iso639_3: 'div' },
  { name: 'dutch', iso639_1: 'nl', iso639_3: 'nld' },
  { name: 'dzongkha', iso639_1: 'dz', iso639_3: 'dzo' },
  { name: 'greek', iso639_1: 'el', iso639_3: 'ell' },
  { name: 'english', iso639_1: 'en', iso639_3: 'eng' },
  { name: 'esperanto', iso639_1: 'eo', iso639_3: 'epo' },
  { name: 'estonian', iso639_1: 'et', iso639_3: 'est' },
  { name: 'ewe', iso639_1: 'ee', iso639_3: 'ewe' },
  { name: 'faroese', iso639_1: 'fo', iso639_3: 'fao' },
  { name: 'persian', iso639_1: 'fa', iso639_3: 'fas' },
  { name: 'fijian', iso639_1: 'fj', iso639_3: 'fij' },
  { name: 'finnish', iso639_1: 'fi', iso639_3: 'fin' },
  { name: 'french', iso639_1: 'fr', iso639_3: 'fra' },
  { name: 'western frisian', iso639_1: 'fy', iso639_3: 'fry' },
  { name: 'fulah', iso639_1: 'ff', iso639_3: 'ful' },
  { name: 'georgian', iso639_1: 'ka', iso639_3: 'kat' },
  { name: 'scottish gaelic', iso639_1: 'gd', iso639_3: 'gla' },
  { name: 'irish', iso639_1: 'ga', iso639_3: 'gle' },
  { name: 'galician', iso639_1: 'gl', iso639_3: 'glg' },
  { name: 'manx', iso639_1: 'gv', iso639_3: 'glv' },
  { name: 'guarani', iso639_1: 'gn', iso639_3: 'grn' },
  { name: 'gujarati', iso639_1: 'gu', iso639_3: 'guj' },
  { name: 'haitian', iso639_1: 'ht', iso639_3: 'hat' },
  { name: 'hausa', iso639_1: 'ha', iso639_3: 'hau' },
  { name: 'hebrew', iso639_1: 'he', iso639_3: 'heb' },
  { name: 'herero', iso639_1: 'hz', iso639_3: 'her' },
  { name: 'hindi', iso639_1: 'hi', iso639_3: 'hin' },
  { name: 'hiri motu', iso639_1: 'ho', iso639_3: 'hmo' },
  { name: 'croatian', iso639_1: 'hr', iso639_3: 'hrv' },
  { name: 'hungarian', iso639_1: 'hu', iso639_3: 'hun' },
  { name: 'igbo', iso639_1: 'ig', iso639_3: 'ibo' },
  { name: 'icelandic', iso639_1: 'is', iso639_3: 'isl' },
  { name: 'ido', iso639_1: 'io', iso639_3: 'ido' },
  { name: 'sichuan yi', iso639_1: 'ii', iso639_3: 'iii' },
  { name: 'inuktitut', iso639_1: 'iu', iso639_3: 'iku' },
  { name: 'interlingue', iso639_1: 'ie', iso639_3: 'ile' },
  { name: 'interlingua', iso639_1: 'ia', iso639_3: 'ina' },
  { name: 'indonesian', iso639_1: 'id', iso639_3: 'ind' },
  { name: 'inupiaq', iso639_1: 'ik', iso639_3: 'ipk' },
  { name: 'italian', iso639_1: 'it', iso639_3: 'ita' },
  { name: 'javanese', iso639_1: 'jv', iso639_3: 'jav' },
  { name: 'japanese', iso639_1: 'ja', iso639_3: 'jpn' },
  { name: 'kalaallisut', iso639_1: 'kl', iso639_3: 'kal' },
  { name: 'kannada', iso639_1: 'kn', iso639_3: 'kan' },
  { name: 'kashmiri', iso639_1: 'ks', iso639_3: 'kas' },
  { name: 'kanuri', iso639_1: 'kr', iso639_3: 'kau' },
  { name: 'kazakh', iso639_1: 'kk', iso639_3: 'kaz' },
  { name: 'central khmer', iso639_1: 'km', iso639_3: 'khm' },
  { name: 'kikuyu', iso639_1: 'ki', iso639_3: 'kik' },
  { name: 'kinyarwanda', iso639_1: 'rw', iso639_3: 'kin' },
  { name: 'kirghiz', iso639_1: 'ky', iso639_3: 'kir' },
  { name: 'komi', iso639_1: 'kv', iso639_3: 'kom' },
  { name: 'kongo', iso639_1: 'kg', iso639_3: 'kon' },
  { name: 'korean', iso639_1: 'ko', iso639_3: 'kor' },
  { name: 'kuanyama', iso639_1: 'kj', iso639_3: 'kua' },
  { name: 'kurdish', iso639_1: 'ku', iso639_3: 'kur' },
  { name: 'lao', iso639_1: 'lo', iso639_3: 'lao' },
  { name: 'latin', iso639_1: 'la', iso639_3: 'lat' },
  { name: 'latvian', iso639_1: 'lv', iso639_3: 'lav' },
  { name: 'limburgan', iso639_1: 'li', iso639_3: 'lim' },
  { name: 'lingala', iso639_1: 'ln', iso639_3: 'lin' },
  { name: 'lithuanian', iso639_1: 'lt', iso639_3: 'lit' },
  { name: 'luxembourgish', iso639_1: 'lb', iso639_3: 'ltz' },
  { name: 'luba-katanga', iso639_1: 'lu', iso639_3: 'lub' },
  { name: 'ganda', iso639_1: 'lg', iso639_3: 'lug' },
  { name: 'macedonian', iso639_1: 'mk', iso639_3: 'mkd' },
  { name: 'marshallese', iso639_1: 'mh', iso639_3: 'mah' },
  { name: 'malayalam', iso639_1: 'ml', iso639_3: 'mal' },
  { name: 'maori', iso639_1: 'mi', iso639_3: 'mri' },
  { name: 'marathi', iso639_1: 'mr', iso639_3: 'mar' },
  { name: 'malay', iso639_1: 'ms', iso639_3: 'msa' },
  { name: 'malagasy', iso639_1: 'mg', iso639_3: 'mlg' },
  { name: 'maltese', iso639_1: 'mt', iso639_3: 'mlt' },
  { name: 'mongolian', iso639_1: 'mn', iso639_3: 'mon' },
  { name: 'nauru', iso639_1: 'na', iso639_3: 'nau' },
  { name: 'navajo', iso639_1: 'nv', iso639_3: 'nav' },
  { name: 'south ndebele', iso639_1: 'nr', iso639_3: 'nbl' },
  { name: 'north ndebele', iso639_1: 'nd', iso639_3: 'nde' },
  { name: 'ndonga', iso639_1: 'ng', iso639_3: 'ndo' },
  { name: 'nepali', iso639_1: 'ne', iso639_3: 'nep' },
  { name: 'norwegian nynorsk', iso639_1: 'nn', iso639_3: 'nno' },
  { name: 'norwegian', iso639_1: 'no', iso639_3: 'nor' },
  { name: 'chichewa', iso639_1: 'ny', iso639_3: 'nya' },
  { name: 'occitan', iso639_1: 'oc', iso639_3: 'oci' },
  { name: 'ojibwa', iso639_1: 'oj', iso639_3: 'oji' },
  { name: 'oriya', iso639_1: 'or', iso639_3: 'ori' },
  { name: 'oromo', iso639_1: 'om', iso639_3: 'orm' },
  { name: 'ossetian', iso639_1: 'os', iso639_3: 'oss' },
  { name: 'panjabi', iso639_1: 'pa', iso639_3: 'pan' },
  { name: 'pali', iso639_1: 'pi', iso639_3: 'pli' },
  { name: 'polish', iso639_1: 'pl', iso639_3: 'pol' },
  { name: 'portuguese', iso639_1: 'pt', iso639_3: 'por' },
  { name: 'pashto', iso639_1: 'ps', iso639_3: 'pus' },
  { name: 'quechua', iso639_1: 'qu', iso639_3: 'que' },
  { name: 'romansh', iso639_1: 'rm', iso639_3: 'roh' },
  { name: 'romanian', iso639_1: 'ro', iso639_3: 'ron' },
  { name: 'rundi', iso639_1: 'rn', iso639_3: 'run' },
  { name: 'russian', iso639_1: 'ru', iso639_3: 'rus' },
  { name: 'sango', iso639_1: 'sg', iso639_3: 'sag' },
  { name: 'sanskrit', iso639_1: 'sa', iso639_3: 'san' },
  { name: 'sinhala', iso639_1: 'si', iso639_3: 'sin' },
  { name: 'slovak', iso639_1: 'sk', iso639_3: 'slk' },
  { name: 'slovenian', iso639_1: 'sl', iso639_3: 'slv' },
  { name: 'northern sami', iso639_1: 'se', iso639_3: 'sme' },
  { name: 'samoan', iso639_1: 'sm', iso639_3: 'smo' },
  { name: 'shona', iso639_1: 'sn', iso639_3: 'sna' },
  { name: 'sindhi', iso639_1: 'sd', iso639_3: 'snd' },
  { name: 'somali', iso639_1: 'so', iso639_3: 'som' },
  { name: 'sotho', iso639_1: 'st', iso639_3: 'sot' },
  { name: 'spanish', iso639_1: 'es', iso639_3: 'spa' },
  { name: 'sardinian', iso639_1: 'sc', iso639_3: 'srd' },
  { name: 'serbian', iso639_1: 'sr', iso639_3: 'srp' },
  { name: 'swati', iso639_1: 'ss', iso639_3: 'ssw' },
  { name: 'sundanese', iso639_1: 'su', iso639_3: 'sun' },
  { name: 'swahili', iso639_1: 'sw', iso639_3: 'swa' },
  { name: 'swedish', iso639_1: 'sv', iso639_3: 'swe' },
  { name: 'tahitian', iso639_1: 'ty', iso639_3: 'tah' },
  { name: 'tamil', iso639_1: 'ta', iso639_3: 'tam' },
  { name: 'tatar', iso639_1: 'tt', iso639_3: 'tat' },
  { name: 'telugu', iso639_1: 'te', iso639_3: 'tel' },
  { name: 'tajik', iso639_1: 'tg', iso639_3: 'tgk' },
  { name: 'tagalog', iso639_1: 'tl', iso639_3: 'tgl' },
  { name: 'thai', iso639_1: 'th', iso639_3: 'tha' },
  { name: 'tigrinya', iso639_1: 'ti', iso639_3: 'tir' },
  { name: 'tonga', iso639_1: 'to', iso639_3: 'ton' },
  { name: 'tswana', iso639_1: 'tn', iso639_3: 'tsn' },
  { name: 'tsonga', iso639_1: 'ts', iso639_3: 'tso' },
  { name: 'turkmen', iso639_1: 'tk', iso639_3: 'tuk' },
  { name: 'turkish', iso639_1: 'tr', iso639_3: 'tur' },
  { name: 'twi', iso639_1: 'tw', iso639_3: 'twi' },
  { name: 'uighur', iso639_1: 'ug', iso639_3: 'uig' },
  { name: 'ukrainian', iso639_1: 'uk', iso639_3: 'ukr' },
  { name: 'urdu', iso639_1: 'ur', iso639_3: 'urd' },
  { name: 'uzbek', iso639_1: 'uz', iso639_3: 'uzb' },
  { name: 'venda', iso639_1: 've', iso639_3: 'ven' },
  { name: 'vietnamese', iso639_1: 'vi', iso639_3: 'vie' },
  { name: 'walloon', iso639_1: 'wa', iso639_3: 'wln' },
  { name: 'wolof', iso639_1: 'wo', iso639_3: 'wol' },
  { name: 'xhosa', iso639_1: 'xh', iso639_3: 'xho' },
  { name: 'yiddish', iso639_1: 'yi', iso639_3: 'yid' },
  { name: 'yoruba', iso639_1: 'yo', iso639_3: 'yor' },
  { name: 'zhuang', iso639_1: 'za', iso639_3: 'zha' },
  { name: 'zulu', iso639_1: 'zu', iso639_3: 'zul' },
];

/**
 * Lookup from any code or name to the canonical language name.
 * Keys: iso639_1 codes, iso639_3 codes, and language names.
 */
const CODE_TO_NAME: Record<string, string> = {};
for (const lang of LANGUAGES) {
  CODE_TO_NAME[lang.iso639_1] = lang.name;
  CODE_TO_NAME[lang.iso639_3] = lang.name;
  CODE_TO_NAME[lang.name] = lang.name;
}

// ISO 639-3 individual language codes that map to the macrolanguage names
// already in LANGUAGES. Classifiers (franc-min especially) return the
// individual codes; this keeps them comparable to user-supplied targets that
// use the more common macrolanguage names/codes.
const MACROLANGUAGE_ALIASES: Record<string, string> = {
  zlm: 'malay', // Standard Malay → Malay
  swh: 'swahili', // Coastal Swahili → Swahili
  arb: 'arabic', // Modern Standard Arabic → Arabic
  cmn: 'chinese', // Mandarin Chinese → Chinese
  pes: 'persian', // Iranian Persian → Persian
  nob: 'norwegian', // Norwegian Bokmål → Norwegian
};
for (const [alias, canonical] of Object.entries(MACROLANGUAGE_ALIASES)) {
  CODE_TO_NAME[alias] = canonical;
}

/**
 * Normalize a language identifier to a full lowercase name.
 *
 * Accepts ISO 639-1 ("en"), ISO 639-3 ("eng"), or a full name ("English").
 * Returns the canonical lowercase name.
 *
 * If the input doesn't match any known code, returns it lowercased as-is.
 */
export const normalizeLanguage = (input: string): string => {
  const lower = input.toLocaleLowerCase().trim();
  return CODE_TO_NAME[lower] ?? lower;
};

/**
 * Check if a language identifier matches a known language.
 *
 * Accepts ISO 639-1 ("en"), ISO 639-3 ("eng"), or a full name ("English").
 */
export const isKnownLanguage = (input: string): boolean => {
  const lower = input.toLocaleLowerCase().trim();
  return lower in CODE_TO_NAME;
};
