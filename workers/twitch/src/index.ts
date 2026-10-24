/**
 * pvtch Twitch Worker (twitch.pvtch.com)
 *
 * Receives EventSub webhooks, queues them, and runs the Lingual chat bot from
 * the queue consumer. User-facing settings live on www (pvtch-api).
 */
import { consume } from './consumer';
import { handleEventSub } from './eventsub/webhook';
import { adminBootstrap } from './routes/admin-bootstrap';
import { botAuthorize, botCallback } from './routes/bot-authorize';

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const route = `${request.method} ${pathname}`;

    switch (route) {
      case 'POST /eventsub': {
        return handleEventSub(request, env);
      }
      case 'GET /bot/authorize': {
        return botAuthorize(request, env);
      }
      case 'GET /bot/callback': {
        return botCallback(request, env);
      }
      case 'GET /admin/bootstrap':
      case 'POST /admin/bootstrap': {
        return adminBootstrap(request, env);
      }
      default: {
        return new Response('Not Found', { status: 404 });
      }
    }
  },

  async queue(batch, env): Promise<void> {
    await consume(batch, env);
  },
} satisfies ExportedHandler<Env>;
