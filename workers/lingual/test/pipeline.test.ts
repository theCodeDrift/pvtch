import { describe, expect, it, vi } from 'vitest';

import {
  MAX_REPLY_LENGTH,
  formatReply,
  translateChatMessage,
} from '../src/lingo/pipeline';
import { preprocess, textFromFragments } from '../src/lingo/preprocess';
import { aiResponse, chatEvent, createTestEnv } from './helpers/fakes';

describe('fragment-based detection input', () => {
  it('drops native emote and mention fragments', () => {
    expect(
      preprocess(
        textFromFragments([
          { type: 'mention', text: '@bob' },
          { type: 'text', text: ' hola amigo ' },
          { type: 'emote', text: 'Kappa' },
        ])
      )
    ).toBe('hola amigo');
  });

  it('still strips third-party emotes that arrive as text', () => {
    expect(
      preprocess(textFromFragments([{ type: 'text', text: 'KEKW que risa' }]))
    ).toBe('que risa');
  });
});

describe('formatReply', () => {
  it('returns nothing when only usernames remain', () => {
    expect(formatReply('@bob @alice')).toBeUndefined();
  });

  it('truncates to 500 characters', () => {
    expect(formatReply('a'.repeat(600))?.length).toBe(MAX_REPLY_LENGTH);
  });
});

describe('translateChatMessage', () => {
  const quiet = { kind: 'quiet' };
  const failed = { kind: 'failed' };
  const spanish = chatEvent();

  it('sends the original text to the LLM and returns the translation', async () => {
    const t = createTestEnv();
    t.ai.mockResolvedValue(
      aiResponse({
        detected: 'Spanish',
        detectedCode: 'spa',
        translation: 'hi friends, how is everyone tonight?',
      })
    );

    const result = await translateChatMessage(t.env, spanish, 'english');

    expect(result).toEqual({
      kind: 'reply',
      reply: 'hi friends, how is everyone tonight?',
    });
    const [, conversation] = t.ai.mock.calls[0] as [
      string,
      { messages: { content: string }[] },
    ];
    expect(conversation.messages.at(-1)?.content).toBe(spanish.message.text);
  });

  it('skips without the LLM when detection says it is already the target language', async () => {
    const t = createTestEnv();
    const english = chatEvent({
      message: {
        text: 'this stream has been absolutely amazing tonight, thank you',
        fragments: [
          {
            type: 'text',
            text: 'this stream has been absolutely amazing tonight, thank you',
          },
        ],
      },
    });

    expect(await translateChatMessage(t.env, english, 'english')).toEqual(
      quiet
    );
    expect(t.ai).not.toHaveBeenCalled();
  });

  it('stays quiet when the LLM reports the target language', async () => {
    const t = createTestEnv();
    t.ai.mockResolvedValue(
      aiResponse({
        detected: 'English',
        detectedCode: 'eng',
        translation: 'whatever',
      })
    );

    expect(await translateChatMessage(t.env, spanish, 'english')).toEqual(
      quiet
    );
  });

  it('stays quiet when only usernames are left', async () => {
    const t = createTestEnv();
    t.ai.mockResolvedValue(
      aiResponse({
        detected: 'Spanish',
        detectedCode: 'spa',
        translation: '@bob',
      })
    );

    expect(await translateChatMessage(t.env, spanish, 'english')).toEqual(
      quiet
    );
  });

  it('fails when the LLM call throws', async () => {
    const t = createTestEnv();
    t.ai.mockRejectedValue(new Error('AI down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await translateChatMessage(t.env, spanish, 'english')).toEqual(
      failed
    );
  });

  it('fails when the LLM returns unusable JSON', async () => {
    const t = createTestEnv();
    t.ai.mockResolvedValue({ choices: [{ message: { content: 'nope' } }] });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await translateChatMessage(t.env, spanish, 'english')).toEqual(
      failed
    );
  });
});
