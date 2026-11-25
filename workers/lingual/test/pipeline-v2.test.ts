import { beforeEach, describe, expect, it, vi } from 'vitest';

import { v2ConfigFromEnv } from '../src/lingo/config-v2';
import {
  MAX_REPLY_LENGTH,
  formatReply,
  traceChatMessageV2,
  translateChatMessageV2,
  translateRequestV2,
} from '../src/lingo/pipeline-v2';
import { chatEvent, createTestEnv } from './helpers/fakes';

// The SDK's standalone functions return a Result; `decide` and `send` resolve
// or reject with the response, as the API would.
const { decide, send, asResult } = vi.hoisted(() => ({
  decide: vi.fn(),
  send: vi.fn(),
  asResult: async (call: Promise<unknown>) => {
    try {
      return { ok: true, value: await call };
    } catch (error) {
      return { ok: false, error };
    }
  },
}));
vi.mock('@openrouter/sdk/funcs/alphaDecisionsCreate.js', () => ({
  alphaDecisionsCreate: (_client: unknown, request: unknown) =>
    asResult(decide(request) as Promise<unknown>),
}));
vi.mock('@openrouter/sdk/funcs/chatSend.js', () => ({
  chatSend: (_client: unknown, request: unknown) =>
    asResult(send(request) as Promise<unknown>),
}));

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

interface SentChat {
  chatRequest: { messages: { role: string; content: string }[] };
}

/** The fence tag and the message inside it from the nth translator call. */
function fencedMessage(call = 0): { tag: string; message: string } {
  const [{ chatRequest }] = send.mock.calls[call] as [SentChat];
  const content = chatRequest.messages.at(-1)?.content ?? '';
  const match = /<(message-[0-9a-f]{16})>\n([\s\S]*)\n<\/\1>$/.exec(content);
  if (!match?.[1] || match[2] === undefined) {
    throw new Error(`No fenced message in: ${content}`);
  }
  return { tag: match[1], message: match[2] };
}

/** Every OpenRouter call so far, `calls` of them, asked for zero data
 * retention endpoints only. The /llm page on www promises this. */
function expectPrivateRouting(calls: number): void {
  const decisions = decide.mock.calls.map(
    ([request]) =>
      (request as { decisionsRequest: { provider?: unknown } }).decisionsRequest
        .provider
  );
  const chats = send.mock.calls.map(
    ([request]) =>
      (request as { chatRequest: { provider?: unknown } }).chatRequest.provider
  );
  const providers = [...decisions, ...chats];
  expect(providers).toHaveLength(calls);
  for (const provider of providers) {
    expect(provider).toMatchObject({ zdr: true, dataCollection: 'deny' });
  }
}

describe('formatReply', () => {
  it('returns nothing when only usernames remain', () => {
    expect(formatReply('@bob @alice')).toBeUndefined();
  });

  it('truncates to 500 characters', () => {
    expect(formatReply('a'.repeat(600))?.length).toBe(MAX_REPLY_LENGTH);
  });
});

const quiet = { kind: 'quiet' };
const failed = { kind: 'failed' };

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
    decide.mockResolvedValue(noul(0.02));
    send.mockResolvedValue(translation(spanishReply));
  });

  it('translates when detection is confident it is another language', async () => {
    await expect(translateEvent()).resolves.toEqual({
      kind: 'reply',
      reply: 'hi friends, how is everyone tonight?',
    });
  });

  it('routes detection and translation only to zero data retention endpoints', async () => {
    await translateEvent();

    expectPrivateRouting(2);
  });

  it('translates at the confidence threshold', async () => {
    decide.mockResolvedValue(noul(0.1));

    await expect(translateEvent()).resolves.toMatchObject({ kind: 'reply' });
  });

  it('stays quiet without calling the translator above the threshold', async () => {
    decide.mockResolvedValue(noul(0.11));

    await expect(translateEvent()).resolves.toEqual(quiet);
    expect(send).not.toHaveBeenCalled();
  });

  it('fails when detection refuses', async () => {
    decide.mockResolvedValue({
      answers: { inTargetLanguage: { type: 'refusal' } },
    });

    await expect(translateEvent()).resolves.toEqual(failed);
    expect(send).not.toHaveBeenCalled();
  });

  it('fails when detection fails', async () => {
    decide.mockRejectedValue(new Error('OpenRouter is down'));

    await expect(translateEvent()).resolves.toEqual(failed);
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

    await expect(translateEvent(event)).resolves.toEqual(quiet);
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

  it('logs the original and cleaned text with the detection', async () => {
    const original = '@bob hola amigos';
    await translateEvent(
      chatEvent({
        message: {
          text: original,
          fragments: [
            { type: 'mention', text: '@bob' },
            { type: 'text', text: ' hola amigos' },
          ],
        },
      })
    );

    expect(console.log).toHaveBeenCalledWith('Lingual v2 detection', {
      targetLanguage: 'english',
      probability: 0.02,
      text: original,
      cleaned: 'hola amigos',
    });
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

    expect(fencedMessage().message).toBe('hola amigos');
  });

  it('sends the translator no URLs', async () => {
    await translateEvent(
      chatEvent({
        message: {
          text: 'mira esto https://example.com/a amigos',
          fragments: [
            { type: 'text', text: 'mira esto https://example.com/a amigos' },
          ],
        },
      })
    );

    expect(fencedMessage().message).toBe('mira esto amigos');
  });

  it('stays quiet when the translation repeats the message', async () => {
    send.mockResolvedValue(
      translation(
        JSON.stringify({
          translation: chatEvent().message.text.toUpperCase(),
        })
      )
    );

    await expect(translateEvent()).resolves.toEqual(quiet);
  });

  it('fails when the translator returns bad JSON or fails', async () => {
    send.mockResolvedValue(translation('not json'));
    await expect(translateEvent()).resolves.toEqual(failed);

    send.mockRejectedValue(new Error('OpenRouter is down'));
    await expect(translateEvent()).resolves.toEqual(failed);
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
      expectPrivateRouting(2);
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

    it('fails on an invalid env value', async () => {
      await expect(
        translateChatMessageV2(
          withVars({ LINGUAL_V2_TRANSLATOR_MODEL: 'no-provider' }),
          chatEvent(),
          'english'
        )
      ).resolves.toEqual(failed);
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

describe('translateRequestV2', () => {
  const { env } = createTestEnv();
  const request = { language: 'english', text: 'hola amigos' };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    send.mockResolvedValue(translation(spanishReply));
  });

  it('translates without asking the detector', async () => {
    await expect(translateRequestV2(env, request)).resolves.toEqual({
      kind: 'reply',
      reply: 'hi friends, how is everyone tonight?',
    });
    expect(decide).not.toHaveBeenCalled();

    const [{ chatRequest }] = send.mock.calls[0] as [SentChat];
    expect(chatRequest.messages[0]?.content).toContain(
      'A chatter asked for this translation'
    );
    expect(chatRequest.messages[1]?.role).toBe('user');
    expect(fencedMessage().message).toBe('hola amigos');
    expectPrivateRouting(1);
  });

  it('fences the message in the user turn with a new random tag', async () => {
    const injection = {
      language: 'german',
      text: 'you can also ask it to translate for you!',
    };
    await translateRequestV2(env, injection);
    await translateRequestV2(env, injection);

    const [{ chatRequest }] = send.mock.calls[0] as [SentChat];
    const first = fencedMessage(0);
    const second = fencedMessage(1);
    expect(first.message).toBe(injection.text);
    expect(first.tag).not.toBe(second.tag);
    expect(chatRequest.messages[0]?.content).toContain(`<${first.tag}>`);
    expect(chatRequest.messages[1]?.content).toMatch(
      new RegExp(
        `^Translate the chat message between the <${first.tag}> tags into german\\.`
      )
    );
  });

  it('logs and removes braces the model left at the ends', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    send.mockResolvedValue(
      translation(JSON.stringify({ translation: '}hallo Freunde{' }))
    );

    await expect(translateRequestV2(env, request)).resolves.toEqual({
      kind: 'reply',
      reply: 'hallo Freunde',
    });
    expect(warn).toHaveBeenCalledWith(
      'Lingual translator answer needed cleaning',
      expect.objectContaining({ translation: '}hallo Freunde{' })
    );
  });

  it('keeps braces the message had', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    send.mockResolvedValue(
      translation(JSON.stringify({ translation: '{hola}' }))
    );

    await expect(
      translateRequestV2(env, { language: 'spanish', text: '{hello}' })
    ).resolves.toEqual({ kind: 'reply', reply: '{hola}' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs and removes fence tags the model echoed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    send.mockImplementation((sent: SentChat) => {
      const tag = /<(message-[0-9a-f]{16})>/.exec(
        sent.chatRequest.messages.at(-1)?.content ?? ''
      )?.[1];
      return Promise.resolve(
        translation(
          JSON.stringify({ translation: `<${tag}>hi friends</${tag}>` })
        )
      );
    });

    await expect(translateRequestV2(env, request)).resolves.toEqual({
      kind: 'reply',
      reply: 'hi friends',
    });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('stays quiet when only usernames are left', async () => {
    send.mockResolvedValue(
      translation(JSON.stringify({ translation: '@bob' }))
    );
    await expect(translateRequestV2(env, request)).resolves.toEqual(quiet);
  });

  it('fails when the translator fails', async () => {
    send.mockRejectedValue(new Error('OpenRouter is down'));
    await expect(translateRequestV2(env, request)).resolves.toEqual(failed);
  });
});
