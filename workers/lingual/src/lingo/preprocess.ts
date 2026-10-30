// The bot's own copy of lingo detection, started from
// workers/core/app/lib/lang-detect. It changes independently of the
// /lingo/translate endpoint; don't import from workers/core.

import type { ChatFragment } from '@pvtch/shared/twitch-eventsub';

const URL_RE = /https?:\/\/\S+/gi;
const MENTION_RE = /@[a-z0-9_]{1,25}/gi;

// A token looks like a Twitch-style emote if it has either:
//   - 3+ consecutive uppercase letters (LULW, KEKW, OMEGALUL), or
//   - an internal capital transition (PogChamp, monkaW, peepoSad, 4Head)
// A single leading capital (Hello, World) is NOT treated as an emote so normal
// sentence-initial words survive the gibberish gate.
const EMOTE_ALL_CAPS_RE = /^[A-Z][A-Z0-9]{2,}$/;
const EMOTE_INTERNAL_CAP_RE = /[a-z0-9][A-Z]/;

function isEmoteToken(token: string): boolean {
  if (EMOTE_ALL_CAPS_RE.test(token)) return true;
  if (EMOTE_INTERNAL_CAP_RE.test(token)) return true;
  return false;
}

// Natural language essentially never has 3+ consecutive identical letters but
// stream chat does constantly ("yeeesss", "haiiiiii", "atissssssssssaaaaa").
// Collapsing 3+ runs to 2 chars shrinks these reaction-style inputs below the
// gibberish-length gate while preserving legitimate doubles like "bookkeeper",
// "Hawaii", "Mississippi". The `u` flag keeps the regex codepoint-aware so
// CJK and other non-BMP characters don't get split mid-character.
const REPEATED_CHAR_RUN_RE = /(.)\1{2,}/gu;
const collapseRepeats = (s: string): string =>
  s.replaceAll(REPEATED_CHAR_RUN_RE, '$1$1');

export function preprocess(input: string): string {
  const stripped = input.replaceAll(URL_RE, ' ').replaceAll(MENTION_RE, ' ');
  const kept: string[] = [];
  for (const token of stripped.split(/\s+/)) {
    if (token.length === 0) continue;
    if (isEmoteToken(token)) continue;
    kept.push(token);
  }
  return collapseRepeats(kept.join(' ').trim());
}

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, {
  granularity: 'grapheme',
});

export function graphemeLength(input: string): number {
  let count = 0;
  for (const _ of GRAPHEME_SEGMENTER.segment(input)) count++;
  return count;
}

/**
 * Detection input from an EventSub chat message: only the `text` fragments.
 * Native emotes, cheermotes and mentions arrive as typed fragments, so they
 * are dropped exactly instead of guessed at. Third-party emotes (7TV, BTTV,
 * FFZ) still arrive as text, so `preprocess` keeps its emote-shape rule.
 */
export function textFromFragments(fragments: readonly ChatFragment[]): string {
  return fragments
    .filter((fragment) => fragment.type === 'text')
    .map((fragment) => fragment.text)
    .join(' ');
}
