/**
 * What the queue consumer does with a message once a handler is done with
 * it. Thrown errors retry with the queue's default backoff instead.
 */
export type Outcome = { type: 'ack' } | { type: 'retry'; delaySeconds: number };

export const ack: Outcome = { type: 'ack' };

export function retryIn(delaySeconds: number): Outcome {
  return { type: 'retry', delaySeconds: Math.max(1, Math.ceil(delaySeconds)) };
}
