/**
 * pvtch Twitch Worker (twitch.pvtch.com)
 *
 * pvtch's Twitch platform layer. Receives EventSub webhooks and queues them;
 * the queue consumer routes events to handler workers (e.g. pvtch-lingual),
 * syncs subscriptions, and posts handlers' replies to chat. User-facing
 * settings live on www (pvtch).
 */
import { consume } from './consumer';
import { handleEventSub } from './eventsub/webhook';
import { adminBootstrap } from './routes/admin-bootstrap';
import { adminFlags } from './routes/admin-flags';
import { adminStatus } from './routes/admin-status';
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
      case 'GET /admin/flags':
      case 'POST /admin/flags': {
        return adminFlags(request, env);
      }
      case 'GET /admin/status': {
        return adminStatus(request, env);
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
