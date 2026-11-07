import type { ChatFragment } from '@pvtch/shared/twitch-eventsub';
import { describe, expect, it } from 'vitest';

import { messageKey } from '../src/lingo/message-key';

function text(value: string): ChatFragment {
  return { type: 'text', text: value } as ChatFragment;
}

function emote(value: string): ChatFragment {
  return { type: 'emote', text: value } as ChatFragment;
}

describe('messageKey', () => {
  it('treats case, punctuation and spacing as the same message', async () => {
    const key = await messageKey([text('hola amigos')]);

    expect(await messageKey([text('  HOLA,   amigos!!! ')])).toBe(key);
  });

  it('ignores emotes, mentions and URLs', async () => {
    const key = await messageKey([text('hola amigos')]);

    expect(
      await messageKey([
        emote('Kappa'),
        text(' hola @someone amigos https://example.com'),
      ])
    ).toBe(key);
  });

  it('keeps different messages apart', async () => {
    expect(await messageKey([text('hola amigos')])).not.toBe(
      await messageKey([text('adiós amigos')])
    );
  });

  it('does not expose the text', async () => {
    expect(await messageKey([text('hola amigos')])).toMatch(
      /^lingual:[0-9a-f]{64}$/
    );
  });

  it('has no key when no words are left', async () => {
    expect(await messageKey([emote('Kappa')])).toBeUndefined();
    expect(await messageKey([text('!!!')])).toBeUndefined();
  });
});
