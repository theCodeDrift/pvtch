import type { OpenRouter } from '@openrouter/sdk';
import { describe, expect, it, vi } from 'vitest';

import { modelSupport } from '../src/dev/model-support';

const clientWith = (...endpoints: string[][]) => {
  const list = vi.fn(() =>
    Promise.resolve({
      data: {
        endpoints: endpoints.map((supportedParameters) => ({
          supportedParameters,
        })),
      },
    })
  );
  return { list, client: { endpoints: { list } } as unknown as OpenRouter };
};

describe('modelSupport', () => {
  it('needs both features on one endpoint to turn thinking off', async () => {
    const { client } = clientWith(['response_format'], ['reasoning']);

    await expect(modelSupport(client, 'lab/split')).resolves.toEqual({
      structuredOutputs: true,
      disableThinking: false,
    });
  });

  it('finds a model that can turn thinking off', async () => {
    const { client } = clientWith(['response_format', 'reasoning']);

    await expect(modelSupport(client, 'lab/full')).resolves.toEqual({
      structuredOutputs: true,
      disableThinking: true,
    });
  });

  it('reports a model without structured outputs', async () => {
    const { client } = clientWith(['temperature']);

    await expect(modelSupport(client, 'lab/plain')).resolves.toEqual({
      structuredOutputs: false,
      disableThinking: false,
    });
  });

  it('looks up a variant under its model and caches the answer', async () => {
    const { client, list } = clientWith(['response_format']);

    await modelSupport(client, 'lab/cached:free');
    await modelSupport(client, 'lab/cached:free');

    expect(list).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledWith({ author: 'lab', slug: 'cached' });
  });
});
