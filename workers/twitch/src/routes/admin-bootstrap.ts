import { htmlPage } from '../html';
import { getSessionUser, isAdmin } from '../session';
import { bootstrapRevokeSubscription } from '../twitch/subscriptions';

/**
 * /admin/bootstrap: GET shows a button, POST creates the app-wide
 * `user.authorization.revoke` subscription (idempotent). The session cookie
 * is SameSite=Lax, which stops other sites but not other *.pvtch.com pages
 * from POSTing here as an admin (see #11).
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

  const result = await bootstrapRevokeSubscription(env);
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
