// Regenerates app/lib/google-fonts.json, the Google Fonts catalog the
// Flag Banner configure page searches. Run: node scripts/google-fonts.mjs
//
// Each entry is [family, category, weights]: category is one letter
// (s sans serif, e serif, d display, h handwriting, m monospace) and
// weights lists the upright weights in hundreds ("49" = 400 and 900).
// Entries are ordered most popular first.
import { writeFileSync } from 'node:fs';

const CATEGORY = {
  'Sans Serif': 's',
  Serif: 'e',
  Display: 'd',
  Handwriting: 'h',
  Monospace: 'm',
};

const response = await fetch('https://fonts.google.com/metadata/fonts');
if (!response.ok) throw new Error(`metadata: HTTP ${response.status}`);
const { familyMetadataList } = await response.json();

const fonts = familyMetadataList
  .filter((font) => font.subsets.includes('latin'))
  .toSorted((a, b) => a.popularity - b.popularity)
  .map((font) => [
    font.family,
    CATEGORY[font.category] ?? 's',
    Object.keys(font.fonts)
      .filter((key) => /^\d00$/.test(key))
      .map((key) => key[0])
      .toSorted()
      .join(''),
  ]);

writeFileSync(
  new URL('../app/lib/google-fonts.json', import.meta.url),
  `${JSON.stringify(fonts)}\n`
);
console.log(`wrote ${fonts.length} fonts`);
