import type { OpenRouter } from '@openrouter/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openRouterClient } from '../src/lingo/openrouter';
import { v2ConfigFromEnv } from '../src/lingo/config-v2';
import {
  traceChatMessageV2,
  translateChatMessageV2,
} from '../src/lingo/pipeline-v2';
import { chatEvent, createTestEnv } from './helpers/fakes';

vi.mock('../src/lingo/openrouter');

const decide = vi.fn();
const send = vi.fn();

const noul = (value: number) => ({
  answers: { inTargetLanguage: { type: 'noul', noul: value } },
});
const translation = (content: unknown) => ({
  choices: [{ message: { content } }],
});
const chatAnswer = (probability: number) =>
  translation(JSON.stringify({ probability }));
const spanishReply = JSON.stringify({
  translation: 'hi friends, how is everyone tonight?',
});

describe('translateChatMessageV2', () => {
  const { env } = createTestEnv();
  const defaults = v2ConfigFromEnv(env);
  const withVars = (vars: Record<string, string>) =>
    ({ ...env, ...vars }) as unknown as Env;
  const translateEvent = (event = chatEvent()) =>
    translateChatMessageV2(env, event, 'english');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(openRouterClient).mockReturnValue({
      alpha: { decisions: { create: decide } },
      chat: { send },
    } as unknown as OpenRouter);
    decide.mockResolvedValue(noul(0.02));
    send.mockResolvedValue(translation(spanishReply));
  });

  it('translates when detection is confident it is another language', async () => {
    await expect(translateEvent()).resolves.toBe(
      'hi friends, how is everyone tonight?'
    );
  });

  it('translates at the confidence threshold', async () => {
    decide.mockResolvedValue(noul(0.1));

    await expect(translateEvent()).resolves.toBeDefined();
  });

  it('stays quiet without calling the translator above the threshold', async () => {
    decide.mockResolvedValue(noul(0.11));

    await expect(translateEvent()).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('stays quiet when detection refuses', async () => {
    decide.mockResolvedValue({
      answers: { inTargetLanguage: { type: 'refusal' } },
    });

    await expect(translateEvent()).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('stays quiet when detection fails', async () => {
    decide.mockRejectedValue(new Error('OpenRouter is down'));

    await expect(translateEvent()).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('calls nothing when only emotes and mentions remain', async () => {
    const event = chatEvent({
      message: {
        text: '@bob Kappa',
        fragments: [
          { type: 'mention', text: '@bob' },
          { type: 'emote', text: 'Kappa' },
        ],
      },
    });

    await expect(translateEvent(event)).resolves.toBeUndefined();
    expect(decide).not.toHaveBeenCalled();
  });

  it('detects on cleaned text and translates the original', async () => {
    const original = '@bob hola amigos, ¿cómo están?';
    await translateEvent(
      chatEvent({
        message: {
          text: original,
          fragments: [
            { type: 'mention', text: '@bob' },
            { type: 'text', text: ' hola amigos, ¿cómo están?' },
          ],
        },
      })
    );

    const [detection] = decide.mock.calls[0] as [
      { decisionsRequest: { state: string } },
    ];
    expect(detection.decisionsRequest.state).toBe('hola amigos, ¿cómo están?');
    expect(JSON.stringify(send.mock.calls[0])).toContain(original);
  });

  it('sends the translator no emotes or cheermotes', async () => {
    await translateEvent(
      chatEvent({
        message: {
          text: 'hola Kappa amigos Cheer100',
          fragments: [
            { type: 'text', text: 'hola ' },
            { type: 'emote', text: 'Kappa' },
            { type: 'text', text: ' amigos ' },
            { type: 'cheermote', text: 'Cheer100' },
          ],
        },
      })
    );

    const [request] = send.mock.calls[0] as [
      { chatRequest: { messages: { role: string; content: string }[] } },
    ];
    expect(request.chatRequest.messages.at(-1)?.content).toBe('hola amigos');
  });

  it('stays quiet when the translation repeats the message', async () => {
    send.mockResolvedValue(
      translation(
        JSON.stringify({
          translation: chatEvent().message.text.toUpperCase(),
        })
      )
    );

    await expect(translateEvent()).resolves.toBeUndefined();
  });

  it('stays quiet when the translator returns bad JSON or fails', async () => {
    send.mockResolvedValue(translation('not json'));
    await expect(translateEvent()).resolves.toBeUndefined();

    send.mockRejectedValue(new Error('OpenRouter is down'));
    await expect(translateEvent()).resolves.toBeUndefined();
  });

  it('traces each stage', async () => {
    await expect(
      traceChatMessageV2(env, chatEvent(), 'english')
    ).resolves.toMatchObject({
      outcome: 'translated',
      probability: 0.02,
      reply: 'hi friends, how is everyone tonight?',
    });

    decide.mockResolvedValue(noul(0.98));
    await expect(
      traceChatMessageV2(env, chatEvent(), 'english')
    ).resolves.toMatchObject({ outcome: 'target-language', probability: 0.98 });

    decide.mockRejectedValue(new Error('OpenRouter is down'));
    await expect(
      traceChatMessageV2(env, chatEvent(), 'english')
    ).resolves.toMatchObject({ outcome: 'detection-failed' });
  });

  describe('with another model pair', () => {
    it('uses the given models and threshold', async () => {
      decide.mockResolvedValue(noul(0.4));

      await traceChatMessageV2(env, chatEvent(), 'english', {
        ...defaults,
        detectorModel: 'lab/decider',
        translatorModel: 'lab/translator',
        maxTargetProbability: 0.5,
        translatorDisableThinking: false,
      });

      expect(JSON.stringify(decide.mock.calls[0])).toContain('lab/decider');
      const [request] = send.mock.calls[0] as [
        { chatRequest: { model: string; reasoning?: unknown } },
      ];
      expect(request.chatRequest.model).toBe('lab/translator');
      expect(request.chatRequest.reasoning).toBeUndefined();
    });

    it('detects through chat with the chat api', async () => {
      send
        .mockResolvedValueOnce(chatAnswer(0.03))
        .mockResolvedValueOnce(translation(spanishReply));

      await expect(
        traceChatMessageV2(env, chatEvent(), 'english', {
          ...defaults,
          detectorApi: 'chat',
          detectorModel: 'lab/chat',
        })
      ).resolves.toMatchObject({ outcome: 'translated', probability: 0.03 });
      expect(decide).not.toHaveBeenCalled();
    });

    it('treats an out-of-range chat answer as a failed detection', async () => {
      send.mockResolvedValue(chatAnswer(7));

      await expect(
        traceChatMessageV2(env, chatEvent(), 'english', {
          ...defaults,
          detectorApi: 'chat',
        })
      ).resolves.toMatchObject({ outcome: 'detection-failed' });
    });

    it('reads its pair and threshold from env', async () => {
      decide.mockResolvedValue(noul(0.4));

      await expect(
        traceChatMessageV2(
          withVars({ LINGUAL_V2_MAX_TARGET_PROBABILITY: '0.5' }),
          chatEvent(),
          'english'
        )
      ).resolves.toMatchObject({ outcome: 'translated' });

      expect(JSON.stringify(decide.mock.calls[0])).toContain(
        'lab/default-decider'
      );
      expect(JSON.stringify(send.mock.calls[0])).toContain(
        'lab/default-translator'
      );
    });

    it('stays quiet on an invalid env value', async () => {
      await expect(
        translateChatMessageV2(
          withVars({ LINGUAL_V2_TRANSLATOR_MODEL: 'no-provider' }),
          chatEvent(),
          'english'
        )
      ).resolves.toBeUndefined();
      expect(decide).not.toHaveBeenCalled();
    });

    it('reports why a call failed', async () => {
      decide.mockRejectedValue(new Error('no such model'));

      await expect(
        traceChatMessageV2(env, chatEvent(), 'english')
      ).resolves.toMatchObject({ error: 'Error: no such model' });
    });
  });
});
