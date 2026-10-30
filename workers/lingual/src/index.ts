/**
 * pvtch Lingual Worker (no routes)
 *
 * Consumes `lingual-events`: chat events pvtch-twitch routed to channels with
 * Lingual enabled. Translates and requests replies through `twitch-events`.
 */
import { consume } from './consumer';

export default {
  async queue(batch, env): Promise<void> {
    await consume(batch, env);
  },
} satisfies ExportedHandler<Env>;
