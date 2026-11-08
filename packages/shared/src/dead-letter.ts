/**
 * Dead-letter queue consumers. A message lands on a `*-dlq` queue after its
 * consumer exhausted `max_retries`; logging it here is the only trace it
 * leaves. Nothing is replayed.
 *
 * Shaped like the Workers `MessageBatch`, which this package has no types for.
 */
export interface DeadLetterBatch {
  readonly queue: string;
  readonly messages: readonly {
    readonly id: string;
    readonly timestamp: Date;
    readonly attempts: number;
    readonly body: unknown;
    ack(): void;
  }[];
}

/**
 * Identifying fields of `twitch-queue` messages. Payloads (`event`, a send's
 * `message` text) are left out: they hold chat text.
 */
const LOGGED_FIELDS = [
  'kind',
  'handlerId',
  'senderId',
  'broadcasterId',
  'messageId',
  'sendId',
  'subscriptionType',
  'timestamp',
] as const;

/** Picks the identifying fields of a dead-lettered body, never its payload. */
export function deadLetterFields(
  body: unknown
): Record<string, string | number> {
  const fields: Record<string, string | number> = {};
  if (typeof body !== 'object' || body === null) {
    return fields;
  }
  const record = body as Record<string, unknown>;
  for (const key of LOGGED_FIELDS) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number') {
      fields[key] = value;
    }
  }
  return fields;
}

/** Logs one structured error per dead-lettered message, then acks it. */
export function consumeDeadLetters(batch: DeadLetterBatch): void {
  for (const message of batch.messages) {
    console.error({
      message: 'Dead-lettered queue message',
      queue: batch.queue,
      id: message.id,
      enqueuedAt: message.timestamp.toISOString(),
      attempts: message.attempts,
      ...deadLetterFields(message.body),
    });
    message.ack();
  }
}
