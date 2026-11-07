import type { ChatFragment } from '@pvtch/shared/twitch-eventsub';

import { preprocess, textFromFragments } from './preprocess';

const PUNCTUATION_RE = /\p{P}/gu;

/**
 * A key for "the same message": detection's text (no emotes, mentions or
 * URLs), ignoring case, punctuation and spacing. It's a hash so the channel
 * never holds chat text. Undefined when no words are left.
 */
export async function messageKey(
  fragments: readonly ChatFragment[]
): Promise<string | undefined> {
  const normalized = preprocess(textFromFragments(fragments))
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll(PUNCTUATION_RE, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
  if (normalized.length === 0) return undefined;

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalized)
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  return `lingual:${hash}`;
}
