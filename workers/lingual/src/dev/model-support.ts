import type { OpenRouter } from '@openrouter/sdk';

export interface ModelSupport {
  structuredOutputs: boolean;
  /** Can turn thinking off on an endpoint that also does structured outputs.
   * v2 requires providers to honor every parameter, so both must be on one. */
  disableThinking: boolean;
}

/** One lookup per model per server run: capabilities rarely change. */
const cache = new Map<string, ModelSupport>();

/** What an OpenRouter model's endpoints support. Asks per model rather than
 * reading the catalog, which leaves out unlisted models. */
export async function modelSupport(
  client: OpenRouter,
  model: string
): Promise<ModelSupport> {
  const cached = cache.get(model);
  if (cached) return cached;

  // A variant such as `:free` shares its model's listing.
  const [id = model] = model.split(':');
  const [author = '', ...slug] = id.split('/');
  const { data } = await client.endpoints.list({
    author,
    slug: slug.join('/'),
  });

  const structured = data.endpoints
    .map(({ supportedParameters }) => supportedParameters as string[])
    .filter((parameters) => parameters.includes('response_format'));
  const support = {
    structuredOutputs: structured.length > 0,
    disableThinking: structured.some((parameters) =>
      parameters.includes('reasoning')
    ),
  };
  cache.set(model, support);
  return support;
}
