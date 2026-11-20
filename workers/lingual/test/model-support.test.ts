import type { OpenRouterCore } from '@openrouter/sdk/core.js';
import { describe, expect, it, vi } from 'vitest';

import { modelSupport } from '../src/dev/model-support';

interface FakeClient {
  list: (request: unknown) => Promise<unknown>;
}

// endpointsList asks the fake client's `list`, wrapped in an ok Result.
vi.mock('@openrouter/sdk/funcs/endpointsList.js', () => ({
  endpointsList: async (client: FakeClient, request: unknown) => ({
    ok: true,
    value: await client.list(request),
  }),
}));

const clientWith = (...endpoints: string[][]) => {
  const list = vi.fn((_request: unknown) =>
    Promise.resolve({
      data: {
        endpoints: endpoints.map((supportedParameters) => ({
          supportedParameters,
        })),
      },
    })
  );
  const fake: FakeClient = { list };
  return { list, client: fake as unknown as OpenRouterCore };
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
