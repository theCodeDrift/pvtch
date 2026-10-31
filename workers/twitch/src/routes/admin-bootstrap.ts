import { htmlPage } from '../html';
import { getSessionUser, isAdmin, isSameOrigin } from '../session';
import { bootstrapRevokeSubscription } from '../twitch/subscriptions';

/**
 * /admin/bootstrap: GET shows a button, POST creates the app-wide
 * `user.authorization.revoke` subscription (idempotent). POSTs must come
 * from a twitch.pvtch.com page (`isSameOrigin`).
 */
export async function adminBootstrap(
  request: Request,
  env: Env
): Promise<Response> {
  if (!isAdmin(env, await getSessionUser(request, env))) {
    return new Response(undefined, { status: 403 });
  }

  if (request.method === 'GET') {
    return htmlPage(
      'Bootstrap',
      '<form method="post"><button>Create user.authorization.revoke subscription</button></form>'
    );
  }

  if (!isSameOrigin(request, env)) {
    return new Response(undefined, { status: 403 });
  }
  const result = await bootstrapRevokeSubscription(env);
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
