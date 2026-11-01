import {
  type RouteConfig,
  index,
  route,
  layout,
} from '@react-router/dev/routes';

export default [
  // Landing page
  index('./routes/_index.tsx'),

  // App pages with shared layout (header, sidebars)
  layout('./components/layout/app-layout.tsx', [
    route('welcome', './routes/welcome.tsx'),
    route('widgets/progress', './routes/widgets/progress.tsx'),
    route('widgets/1s', './routes/widgets/1s.tsx'),
    route('widgets/todo', './routes/widgets/todo.tsx'),
    route('helpers/lingo', './routes/helpers/lingo.tsx'),
    route('bots/lingual', './routes/bots.lingual.tsx'),
    route('howto/deploy-your-own', './routes/howto/deploy-your-own.tsx'),
    route('howto/board', './routes/howto/board.tsx'),
    route('board', './routes/board._index.tsx'),
  ]),

  // Private instance page (no layout)
  route('private', './routes/private.tsx'),

  // OBS sources (no layout - minimal HTML for embedding)
  route(
    'sources/progress/:token/:name',
    './routes/sources/progress.$token.$name.tsx'
  ),
  route('sources/todo/:channel', './routes/sources/todo.$channel.tsx'),
  route('sources/1s/:channel', './routes/sources/1s.$channel.tsx'),

  // Board widget (anonymous-by-URL, no layout)
  route('board/new', './routes/board.new.tsx'),
  route('board/:id', './routes/board.$id.tsx'),
  route('board/:id/edit/:key', './routes/board.$id.edit.$key.tsx'),
  route(
    'board/:id/edit/:key/presence',
    './routes/board.$id.edit.$key.presence.tsx'
  ),
  route(
    'board/:id/edit/:key/revert',
    './routes/board.$id.edit.$key.revert.tsx'
  ),
  route('board/:id/delete', './routes/board.$id.delete.tsx'),
  route('board/:id/rotate', './routes/board.$id.rotate.tsx'),

  // Health check
  route('health', './routes/health.tsx'),

  // Machine-readable site info for AI assistants
  route('llms.txt', './routes/llms.txt.tsx'),

  // Auth routes (loader only)
  route('auth/start', './routes/auth/start.tsx'),
  route('auth/callback', './routes/auth/callback.tsx'),
  route('auth/logout', './routes/auth/logout.tsx'),
  route('auth/grant', './routes/auth/grant.tsx'),
  route('auth/grant/callback', './routes/auth/grant.callback.tsx'),

  // API routes (loader/action only)
  route('lingo/translate/:token', './routes/lingo.translate.$token.tsx'),
  route('lingo/config/:token/set', './routes/lingo.config.$token.set.tsx'),
  route('progress/:token/:name/get', './routes/progress.$token.$name.get.tsx'),
  route('progress/:token/:name/set', './routes/progress.$token.$name.set.tsx'),

  // Deprecated routes (return 410 Gone)
  route(':token/kv/:id/set', './routes/deprecated/$token.kv.$id.set.tsx'),
  route(':token/kv/:id/get', './routes/deprecated/$token.kv.$id.get.tsx'),
  route(
    ':token/lingo/config/set',
    './routes/deprecated/$token.lingo.config.set.tsx'
  ),
  route(
    ':token/lingo/config/get',
    './routes/deprecated/$token.lingo.config.get.tsx'
  ),
  route(
    ':token/progress/:name/set',
    './routes/deprecated/$token.progress.$name.set.tsx'
  ),
  route(
    ':token/progress/:name/get',
    './routes/deprecated/$token.progress.$name.get.tsx'
  ),

  // Catch-all 404
  route('*', './routes/$.tsx'),
] satisfies RouteConfig;
