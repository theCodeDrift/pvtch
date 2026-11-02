import { Link, useLoaderData, data } from 'react-router';
import type { Route } from './+types/welcome';
import { userContext } from '@/context';

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Welcome to PVTCH' },
    {
      name: 'description',
      content: 'Welcome to PVTCH. Free tools for Twitch streamers.',
    },
  ];
}

export function loader({ context }: Route.LoaderArgs) {
  const user = context.get(userContext);
  return data({
    displayName: user?.displayName ?? '',
  });
}

export default function Welcome() {
  const { displayName } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {displayName ? `Welcome, ${displayName}!` : 'Welcome, friend!'}
        </h1>
        <p className="mt-2 text-muted-foreground">
          PVTCH is a collection of free, self-hostable tools built for Twitch
          streamers. No ads, no tracking, no nonsense.
        </p>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Get started</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link
            to="/widgets/progress"
            className="rounded-lg border border-border p-4 hover:bg-accent transition-colors"
          >
            <h3 className="font-medium">Progress Bar</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Customizable progress bars for OBS. Track sub goals, donations, or
              any metric with real-time updates.
            </p>
          </Link>
          <Link
            to="/widgets/todo"
            className="rounded-lg border border-border p-4 hover:bg-accent transition-colors"
          >
            <h3 className="font-medium">Chat Tasks</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Collaborative task list overlay for your stream. Viewers add and
              complete tasks via chat commands.
            </p>
          </Link>
          <Link
            to="/widgets/1s"
            className="rounded-lg border border-border p-4 hover:bg-accent transition-colors"
          >
            <h3 className="font-medium">Quick Poll</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Real-time chat polls for your stream. Viewers type their vote in
              chat and results display as animated bar charts.
            </p>
          </Link>
          <Link
            to="/helpers/lingo"
            className="rounded-lg border border-border p-4 hover:bg-accent transition-colors"
          >
            <h3 className="font-medium">Lingo</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Automatic chat translation powered by AI. Let your community speak
              any language and still be understood.
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
