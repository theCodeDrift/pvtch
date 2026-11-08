/**
 * pvtch Lingual Worker (no routes)
 *
 * Consumes `lingual-events`: chat events pvtch-twitch routed to channels with
 * Lingual enabled. Translates and requests replies through `twitch-events`.
 * Also logs what dead-letters on `lingual-events-dlq`.
 */
import { consumeDeadLetters } from '@pvtch/shared/dead-letter';

import { consume } from './consumer';

export default {
  async queue(batch, env): Promise<void> {
    if (batch.queue === 'lingual-events-dlq') {
      consumeDeadLetters(batch);
      return;
    }
    await consume(batch, env);
  },
} satisfies ExportedHandler<Env>;
