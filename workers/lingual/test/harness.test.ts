import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatEvent, runEval } from '../src/dev/harness';
import { modelSupport } from '../src/dev/model-support';
import { traceChatMessageV2 } from '../src/lingo/pipeline-v2';
import { V2_VARS } from './helpers/fakes';

vi.mock('../src/dev/model-support');
vi.mock('../src/lingo/pipeline-v2', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  traceChatMessageV2: vi.fn(() =>
    Promise.resolve({ outcome: 'target-language', cleaned: 'hola' })
  ),
}));

describe('harness chatEvent', () => {
  it('types mentions as fragments, as Twitch does', () => {
    const { broadcaster_user_id, message } = chatEvent(
      '123',
      '@bob hola amigo',
      'message-1'
    );
    expect(broadcaster_user_id).toBe('123');
    expect(message.text).toBe('@bob hola amigo');
    expect(message.fragments).toEqual([
      { type: 'mention', text: '@bob' },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'hola' },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'amigo' },
    ]);
  });

  it('types named emotes as fragments', () => {
    const { message } = chatEvent('123', 'hola curlyg5Wow', 'message-1', [
      'curlyg5Wow',
    ]);
    expect(message.fragments).toEqual([
      { type: 'text', text: 'hola' },
      { type: 'text', text: ' ' },
      { type: 'emote', text: 'curlyg5Wow' },
    ]);
  });
});

const post = (body: unknown) =>
  runEval(
    new Request('http://localhost/evals/run', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    V2_VARS as unknown as Parameters<typeof runEval>[1]
  );

const lookup = vi.mocked(modelSupport);

const pair = {
  detectorApi: 'decisions',
  detectorModel: 'lab/decider',
  translatorModel: 'lab/translator',
  maxTargetProbability: 0.1,
};

describe('harness runEval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lookup.mockResolvedValue({
      structuredOutputs: true,
      disableThinking: true,
    });
  });

  it('runs the path with the pair it was given', async () => {
    await post({ text: 'hola', config: pair });

    expect(traceChatMessageV2).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      'english',
      {
        ...pair,
        detectorDisableThinking: false,
        translatorDisableThinking: true,
      }
    );
  });

  it('turns thinking off per model', async () => {
    lookup.mockImplementation((_client, model) =>
      Promise.resolve({
        structuredOutputs: true,
        disableThinking: model === 'lab/chat-detector',
      })
    );

    await post({
      text: 'hola',
      config: {
        ...pair,
        detectorApi: 'chat',
        detectorModel: 'lab/chat-detector',
      },
    });

    expect(traceChatMessageV2).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      'english',
      expect.objectContaining({
        detectorDisableThinking: true,
        translatorDisableThinking: false,
      })
    );
  });

  it('skips a model without structured outputs', async () => {
    lookup.mockResolvedValue({
      structuredOutputs: false,
      disableThinking: false,
    });

    const response = await post({ text: 'hola', config: pair });

    await expect(response.json()).resolves.toMatchObject({
      outcome: 'translate-failed',
      error: "lab/translator doesn't support structured outputs",
    });
    expect(traceChatMessageV2).not.toHaveBeenCalled();
  });

  it('still runs a model it cannot look up, leaving thinking alone', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    lookup.mockRejectedValue(new Error('not found'));

    await post({
      text: 'hola',
      config: { ...pair, translatorModel: 'lab/unlisted' },
    });

    expect(traceChatMessageV2).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      'english',
      expect.objectContaining({
        translatorModel: 'lab/unlisted',
        translatorDisableThinking: false,
      })
    );
  });

  it('rejects a model without its provider', async () => {
    const response = await post({
      text: 'hola',
      config: { ...pair, translatorModel: 'gemma-3-12b-it' },
    });

    expect(response.status).toBe(400);
    expect(traceChatMessageV2).not.toHaveBeenCalled();
  });

  it('defaults to the production pair', async () => {
    await post({ text: 'hola' });

    expect(traceChatMessageV2).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      'english',
      expect.objectContaining({
        detectorModel: V2_VARS.LINGUAL_V2_DETECTOR_MODEL,
        translatorModel: V2_VARS.LINGUAL_V2_TRANSLATOR_MODEL,
      })
    );
  });

  it('rejects a bad pair', async () => {
    const response = await post({
      text: 'hola',
      config: { ...pair, maxTargetProbability: 2 },
    });

    expect(response.status).toBe(400);
  });
});
