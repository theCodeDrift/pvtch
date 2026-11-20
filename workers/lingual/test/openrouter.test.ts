import { OpenRouterError } from '@openrouter/sdk/models/errors';
import { describe, expect, it } from 'vitest';

import { describeOpenRouterError } from '../src/lingo/openrouter';

describe('describeOpenRouterError', () => {
  it('keeps the status and body of an HTTP error', () => {
    const body = JSON.stringify({ error: { message: 'No endpoints found' } });
    const error = new OpenRouterError('No endpoints found', {
      request: new Request('https://openrouter.ai/api/v1/decisions'),
      response: new Response(body, { status: 404 }),
      body,
    });
    expect(describeOpenRouterError(error)).toEqual({
      name: 'OpenRouterError',
      status: 404,
      message: 'No endpoints found',
      body,
    });
  });

  it('caps a long body', () => {
    const body = 'x'.repeat(5000);
    const error = new OpenRouterError('boom', {
      request: new Request('https://openrouter.ai/api/v1/decisions'),
      response: new Response(body, { status: 500 }),
      body,
    });
    expect(describeOpenRouterError(error).body).toHaveLength(1000);
  });

  it('keeps the message of any other error', () => {
    expect(describeOpenRouterError(new TypeError('bad'))).toMatchObject({
      name: 'TypeError',
      message: 'bad',
    });
  });
});
