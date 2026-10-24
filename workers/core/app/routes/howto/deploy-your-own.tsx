import { ExternalLink, GithubIcon, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function meta() {
  return [
    { title: 'Self-Host PVTCH on Cloudflare Workers - Free Deployment Guide' },
    {
      name: 'description',
      content:
        'Deploy your own PVTCH instance on Cloudflare Workers for free. Step-by-step guide covering Twitch OAuth setup, KV namespaces, Durable Objects, and Workers AI configuration.',
    },
    { property: 'og:title', content: 'Self-Host PVTCH on Cloudflare Workers' },
    {
      property: 'og:description',
      content:
        'Deploy your own PVTCH instance on Cloudflare Workers for free. Full control over your streaming tools.',
    },
  ];
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="absolute right-2 top-2 p-1.5 rounded-md bg-muted hover:bg-accent transition-colors"
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="size-4 text-green-500" />
      ) : (
        <Copy className="size-4 text-muted-foreground" />
      )}
    </button>
  );
}

function CodeBlock({
  children,
  copyable,
}: {
  children: string;
  copyable?: boolean;
}) {
  return (
    <div className="relative">
      <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
        <code>{children}</code>
      </pre>
      {copyable && <CopyButton text={children} />}
    </div>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative pl-12 pb-8 last:pb-0">
      {/* Connector line */}
      <div className="absolute left-4 top-10 bottom-0 w-px bg-border last:hidden" />
      {/* Step number */}
      <div className="absolute left-0 top-0 flex size-8 items-center justify-center rounded-full bg-brand text-white text-sm font-bold">
        {number}
      </div>
      <h3 className="text-xl font-semibold mb-3">{title}</h3>
      <div className="space-y-4 text-muted-foreground">{children}</div>
    </div>
  );
}

export default function DeployYourOwn() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">
        Deploy Your Own PVTCH Instance
      </h1>
      <p className="text-lg text-muted-foreground mb-4">
        PVTCH is fully open source and designed to run on Cloudflare's free
        tier. Follow this guide to deploy your own instance with complete
        control over your data and customization.
      </p>
      <p className="text-muted-foreground mb-8">
        Hosting your own instance also helps us save on infrastructure costs, so
        we can continue offering PVTCH to as many streamers as possible.
      </p>

      {/* Why self-host */}
      <div className="mb-12 p-6 rounded-xl border border-border bg-card">
        <h2 className="text-xl font-semibold mb-3">Why Deploy Your Own?</h2>
        <ul className="space-y-2 text-muted-foreground">
          <li className="flex gap-2">
            <span className="text-brand">&#10003;</span>
            Full control over your data and privacy
          </li>
          <li className="flex gap-2">
            <span className="text-brand">&#10003;</span>
            Customize features and branding for your stream
          </li>
          <li className="flex gap-2">
            <span className="text-brand">&#10003;</span>
            No dependency on a third-party service
          </li>
          <li className="flex gap-2">
            <span className="text-brand">&#10003;</span>
            Contribute improvements back to the community
          </li>
        </ul>
      </div>

      {/* Free tier callout */}
      <div className="mb-12 p-6 rounded-xl border border-brand/30 bg-brand/5">
        <h2 className="text-xl font-semibold mb-3">Cloudflare Free Tier</h2>
        <p className="text-muted-foreground mb-4">
          Cloudflare offers a generous free tier that's more than enough for
          individual streamers. Even during busy streams, you'd be challenged to
          reach these limits:
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <div className="font-semibold">Workers</div>
            <div className="text-sm text-muted-foreground">
              100,000 requests/day
            </div>
            <a
              href="https://developers.cloudflare.com/workers/platform/pricing/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-brand hover:underline inline-flex items-center gap-1"
            >
              Pricing <ExternalLink className="size-3" />
            </a>
          </div>
          <div>
            <div className="font-semibold">Durable Objects</div>
            <div className="text-sm text-muted-foreground">
              Included with Workers
            </div>
            <a
              href="https://developers.cloudflare.com/durable-objects/platform/pricing/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-brand hover:underline inline-flex items-center gap-1"
            >
              Pricing <ExternalLink className="size-3" />
            </a>
          </div>
          <div>
            <div className="font-semibold">Workers AI</div>
            <div className="text-sm text-muted-foreground">
              10,000 neurons/day
            </div>
            <a
              href="https://developers.cloudflare.com/workers-ai/platform/pricing/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-brand hover:underline inline-flex items-center gap-1"
            >
              Pricing <ExternalLink className="size-3" />
            </a>
          </div>
        </div>
      </div>

      {/* Prerequisites */}
      <div className="mb-12">
        <h2 className="text-2xl font-bold mb-4">Prerequisites</h2>
        <ul className="space-y-2 text-muted-foreground">
          <li>
            <strong>GitHub account</strong> - to fork the repository
          </li>
          <li>
            <strong>Cloudflare account</strong> -{' '}
            <a
              href="https://dash.cloudflare.com/sign-up"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand hover:underline"
            >
              Sign up free
            </a>
          </li>
          <li>
            <strong>Twitch Developer account</strong> -{' '}
            <a
              href="https://dev.twitch.tv/console"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand hover:underline"
            >
              Developer Console
            </a>
          </li>
          <li>
            <strong>Node.js 20+</strong> and <strong>pnpm</strong> installed
            locally
          </li>
        </ul>
      </div>

      {/* How it's split up */}
      <div id="how-pvtch-is-split-up" className="mb-12 scroll-mt-20">
        <h2 className="text-2xl font-bold mb-4">How PVTCH Is Split Up</h2>
        <div className="space-y-4 text-muted-foreground">
          <p>
            PVTCH deploys as more than one Cloudflare Worker, all from the same
            repository:
          </p>
          <ul className="list-disc list-inside space-y-2 ml-2">
            <li>
              <strong>pvtch-storage</strong> (
              <code className="bg-muted px-1 rounded">workers/storage</code>)
              holds the Durable Objects that more than one worker needs. It has
              no pages of its own.
            </li>
            <li>
              <strong>pvtch</strong> (
              <code className="bg-muted px-1 rounded">workers/core</code>) is
              the website, widgets, OBS sources and Lingo.
            </li>
            <li>
              <strong>pvtch-twitch</strong> (
              <code className="bg-muted px-1 rounded">workers/twitch</code>,
              optional) runs Lingual, the chat bot that translates messages in
              your Twitch chat. It receives Twitch EventSub webhooks on its own
              domain.
            </li>
          </ul>
          <p>
            <strong>Why separate workers?</strong> A Durable Object lives in
            exactly one worker. Other workers can reach it, but only through a
            binding that names the worker it lives in (
            <code className="bg-muted px-1 rounded">script_name</code>). Keeping
            shared Durable Objects in a small worker of their own means
            redeploying the website never touches them, and other workers, like
            the chat bot, share the same state.
          </p>
          <p>
            <strong>Why storage deploys first:</strong> Cloudflare refuses to
            deploy a worker whose binding points at a Durable Object class that
            doesn't exist yet. Deploying{' '}
            <code className="bg-muted px-1 rounded">pvtch-storage</code> first
            creates those classes, so every worker that binds them deploys
            cleanly. The same reasoning applies in reverse: to remove a class,
            first remove the bindings to it, then remove the class from storage
            in a later deploy.
          </p>
        </div>
      </div>

      {/* Steps */}
      <div className="mb-12">
        <h2 className="text-2xl font-bold mb-6">Deployment Steps</h2>

        <Step number={1} title="Fork the Repository">
          <p>
            Start by forking the PVTCH repository to your GitHub account. This
            gives you your own copy to customize and deploy.
          </p>
          <Button variant="outline" className="gap-2" asChild>
            <a
              href="https://github.com/thecodedrift/pvtch/fork"
              target="_blank"
              rel="noopener noreferrer"
            >
              <GithubIcon className="size-4" />
              Fork on GitHub
              <ExternalLink className="size-4" />
            </a>
          </Button>
          <p className="text-sm">After forking, clone your fork locally:</p>
          <CodeBlock copyable>
            {`git clone https://github.com/YOUR_USERNAME/pvtch.git
cd pvtch
pnpm install`}
          </CodeBlock>
        </Step>

        <Step number={2} title="Create a Twitch Application">
          <p>
            PVTCH uses Twitch OAuth for authentication. You'll need to create
            your own Twitch application:
          </p>
          <ol className="list-decimal list-inside space-y-2 ml-2">
            <li>
              Go to the{' '}
              <a
                href="https://dev.twitch.tv/console/apps"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline"
              >
                Twitch Developer Console
              </a>
            </li>
            <li>Click "Register Your Application"</li>
            <li>
              <strong>Name:</strong> Your app name (e.g., "My PVTCH")
            </li>
            <li>
              <strong>OAuth Redirect URLs:</strong>
              <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                <li>
                  <code className="bg-muted px-1 rounded text-sm">
                    https://your-worker.your-subdomain.workers.dev/auth/callback
                  </code>
                </li>
                <li>
                  <code className="bg-muted px-1 rounded text-sm">
                    https://your-worker.your-subdomain.workers.dev/auth/grant/callback
                  </code>{' '}
                  (extra Twitch permissions, such as the chat bot&apos;s)
                </li>
                <li>
                  <code className="bg-muted px-1 rounded text-sm">
                    http://localhost:5173/auth/callback
                  </code>{' '}
                  (for local dev)
                </li>
              </ul>
            </li>
            <li>
              <strong>Category:</strong> Website Integration
            </li>
            <li>
              Click "Create" and note your <strong>Client ID</strong>
            </li>
            <li>
              Click "New Secret" and save your <strong>Client Secret</strong>
            </li>
          </ol>
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-sm">
            <strong>Important:</strong> Keep your Client Secret safe! Never
            commit it to your repository.
          </div>
        </Step>

        <Step number={3} title="Configure Cloudflare Resources">
          <p>Install the Wrangler CLI and log in to your Cloudflare account:</p>
          <CodeBlock copyable>
            {`pnpm add -g wrangler
wrangler login`}
          </CodeBlock>

          <p>Create the required KV namespaces:</p>
          <CodeBlock copyable>
            {`# General storage
wrangler kv namespace create PVTCH_KV

# Account/token mappings
wrangler kv namespace create PVTCH_ACCOUNTS`}
          </CodeBlock>

          <p>
            Each command will output an ID. Update{' '}
            <code className="bg-muted px-1 rounded">
              workers/core/wrangler.jsonc
            </code>{' '}
            with your namespace IDs:
          </p>
          <CodeBlock>
            {`"kv_namespaces": [
  {
    "binding": "PVTCH_KV",
    "id": "YOUR_KV_ID_HERE"
  },
  {
    "binding": "PVTCH_ACCOUNTS",
    "id": "YOUR_ACCOUNTS_ID_HERE"
  }
]`}
          </CodeBlock>

          <p>
            Create the chat bot&apos;s queues. The storage worker sends to{' '}
            <code className="bg-muted px-1 rounded">twitch-events</code>, so it
            won&apos;t deploy without it, even if you never run the bot:
          </p>
          <CodeBlock copyable>
            {`wrangler queues create twitch-events
wrangler queues create twitch-events-dlq`}
          </CodeBlock>
        </Step>

        <Step number={4} title="Update Configuration">
          <p>
            Update the Twitch client ID and URLs in{' '}
            <code className="bg-muted px-1 rounded">
              workers/core/wrangler.jsonc
            </code>
            :
          </p>
          <CodeBlock>
            {`"vars": {
  "TWITCH_CLIENT_ID": "your_twitch_client_id",
  "TWITCH_REDIRECT_URI": "https://your-domain.com/auth/callback",
  "PVTCH_APP_URL": "https://your-domain.com"
}`}
          </CodeBlock>

          <p>
            Store your Twitch client secret in your Cloudflare account&apos;s
            Secrets Store (it&apos;s shared by every PVTCH worker), then put
            your store&apos;s id in the{' '}
            <code className="bg-muted px-1 rounded">secrets_store_secrets</code>{' '}
            entries of{' '}
            <code className="bg-muted px-1 rounded">
              workers/core/wrangler.jsonc
            </code>{' '}
            (and{' '}
            <code className="bg-muted px-1 rounded">
              workers/twitch/wrangler.jsonc
            </code>{' '}
            if you run the chat bot):
          </p>
          <CodeBlock copyable>
            {`wrangler secrets-store store list --remote
wrangler secrets-store secret create YOUR_STORE_ID \\
  --name TWITCH_SECRET --scopes workers --remote`}
          </CodeBlock>
          <p className="text-sm">
            You&apos;ll be prompted to enter the secret value securely. If you
            have no store yet, create one with{' '}
            <code className="bg-muted px-1 rounded">
              wrangler secrets-store store create pvtch --remote
            </code>
            .
          </p>
        </Step>

        <Step number={5} title="Local Development (Optional)">
          <p>
            For local development, create a{' '}
            <code className="bg-muted px-1 rounded">.dev.vars</code> file in{' '}
            <code className="bg-muted px-1 rounded">workers/core/</code>:
          </p>
          <CodeBlock>
            {`# Copy from .dev.vars.example
TWITCH_CLIENT_ID=your_twitch_client_id
TWITCH_REDIRECT_URI=http://localhost:5173/auth/callback
PVTCH_APP_URL=http://localhost:5173`}
          </CodeBlock>

          <p>
            Wrangler emulates the Secrets Store locally, so add the Twitch
            secret there once:
          </p>
          <CodeBlock copyable>
            {`cd workers/core
wrangler secrets-store secret create YOUR_STORE_ID \\
  --name TWITCH_SECRET --scopes workers`}
          </CodeBlock>

          <p>Then start the dev server:</p>
          <CodeBlock copyable>
            {`cd workers/core
pnpm run dev`}
          </CodeBlock>
        </Step>

        <Step number={6} title="Deploy">
          <p>
            Deploy the storage worker first, then the app (see{' '}
            <a
              href="#how-pvtch-is-split-up"
              className="text-brand hover:underline"
            >
              why
            </a>
            ):
          </p>
          <CodeBlock copyable>
            {`pnpm --filter @pvtch/storage deploy
pnpm --filter @pvtch/core deploy
# optional: the Lingual chat bot (see below)
pnpm --filter @pvtch/twitch deploy`}
          </CodeBlock>
          <p className="text-sm">
            Each deploy runs typechecking, linting and tests first. Later
            deploys only need the worker you changed; storage first whenever
            both changed.
          </p>

          <p>
            Your app will be available at{' '}
            <code className="bg-muted px-1 rounded">
              https://pvtch.YOUR_SUBDOMAIN.workers.dev
            </code>
          </p>

          <p>
            <strong>Deploy from GitHub (optional):</strong> your fork includes{' '}
            <code className="bg-muted px-1 rounded">
              .github/workflows/deploy.yml
            </code>
            , which deploys every push to{' '}
            <code className="bg-muted px-1 rounded">main</code> in the right
            order, storage first, and only the workers that changed. Add{' '}
            <code className="bg-muted px-1 rounded">CLOUDFLARE_API_TOKEN</code>{' '}
            and{' '}
            <code className="bg-muted px-1 rounded">CLOUDFLARE_ACCOUNT_ID</code>{' '}
            as repository secrets to turn it on; without them it skips the
            deploy with a warning. Don't also connect Cloudflare's own Git
            builds to these workers: they can't deploy storage first.
          </p>

          <p>
            <strong>Custom domain (optional):</strong> You can add a custom
            domain in the Cloudflare dashboard under Workers &rarr; your worker
            &rarr; Settings &rarr; Domains & Routes.
          </p>
        </Step>

        <Step number={7} title="Lingual Chat Bot (Optional)">
          <p>
            Lingual chats as a Twitch account of its own and replies to messages
            that aren&apos;t in the streamer&apos;s language. It runs in the{' '}
            <code className="bg-muted px-1 rounded">pvtch-twitch</code> worker
            on its own domain, because Twitch delivers chat to it over webhooks.
          </p>
          <ol className="list-decimal list-inside space-y-2 ml-2">
            <li>
              Create a Twitch account for the bot and note its user id. Put it
              in{' '}
              <code className="bg-muted px-1 rounded">TWITCH_BOT_USER_ID</code>{' '}
              in{' '}
              <code className="bg-muted px-1 rounded">
                workers/twitch/wrangler.jsonc
              </code>
              , and use the same{' '}
              <code className="bg-muted px-1 rounded">TWITCH_CLIENT_ID</code> as
              the app. Streamers grant the bot permission to that app.
            </li>
            <li>
              Pick a domain for the worker (the{' '}
              <code className="bg-muted px-1 rounded">routes</code> entry and{' '}
              <code className="bg-muted px-1 rounded">TWITCH_APP_URL</code>) and
              add{' '}
              <code className="bg-muted px-1 rounded">
                https://YOUR_BOT_DOMAIN/bot/callback
              </code>{' '}
              to your Twitch app&apos;s redirect URLs.
            </li>
            <li>
              Set your Twitch login in{' '}
              <code className="bg-muted px-1 rounded">ADMIN_USERS</code> (twitch
              worker) and{' '}
              <code className="bg-muted px-1 rounded">
                LINGUAL_PREVIEW_USERS
              </code>{' '}
              (core). Both are empty-means-nobody lists.
            </li>
            <li>
              Add the EventSub signing secret to the same Secrets Store, and set
              your store&apos;s id in{' '}
              <code className="bg-muted px-1 rounded">
                workers/twitch/wrangler.jsonc
              </code>
              :
            </li>
          </ol>
          <CodeBlock copyable>
            {`wrangler secrets-store secret create YOUR_STORE_ID \\
  --name TWITCH_EVENTSUB_SECRET --scopes workers --remote
# any random 10-100 characters`}
          </CodeBlock>
          <p>
            After deploying, log into Twitch and your PVTCH site{' '}
            <strong>as the bot account</strong> and open{' '}
            <code className="bg-muted px-1 rounded">/bot/authorize</code> on the
            bot&apos;s domain. Then log back in as yourself, open{' '}
            <code className="bg-muted px-1 rounded">/admin/bootstrap</code> and
            press its button. Streamers then turn Lingual on from Bots &rarr;
            Lingual.
          </p>
          <p className="text-sm">
            Full details are in{' '}
            <a
              href="https://github.com/thecodedrift/pvtch/blob/main/workers/twitch/README.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand hover:underline"
            >
              workers/twitch/README.md
            </a>
            .
          </p>
        </Step>
      </div>

      {/* Locking Down Your Instance */}
      <div className="mb-12">
        <h2 className="text-2xl font-bold mb-4">Locking Down Your Instance</h2>
        <p className="text-muted-foreground mb-4">
          By default, anyone can log in and use your PVTCH instance. To restrict
          access to specific Twitch users, set the{' '}
          <code className="bg-muted px-1 rounded">ALLOWED_USERS</code>{' '}
          environment variable.
        </p>
        <CodeBlock>
          {`# In your .dev.vars (local) or Cloudflare dashboard (production)
ALLOWED_USERS=your_username,friend_username,another_user`}
        </CodeBlock>
        <div className="mt-4 space-y-2 text-muted-foreground text-sm">
          <p>
            When set, only users whose Twitch username is in the comma-separated
            list can access widgets and OBS sources. Other users who log in will
            see an indicator that the instance is private.
          </p>
          <p>
            To set this in production via the Cloudflare dashboard: go to
            Workers &rarr; your worker &rarr; Settings &rarr; Variables and
            Secrets, and add{' '}
            <code className="bg-muted px-1 rounded">ALLOWED_USERS</code> with
            your comma-separated usernames. Changes take effect immediately.
          </p>
          <p>Leave it empty or unset to keep your instance open to everyone.</p>
        </div>
      </div>

      {/* Troubleshooting */}
      <div className="mb-12">
        <h2 className="text-2xl font-bold mb-4">Troubleshooting</h2>
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold">OAuth redirect mismatch</h3>
            <p className="text-muted-foreground text-sm">
              Make sure the redirect URI in your Twitch app settings exactly
              matches what's in your wrangler.jsonc (including https vs http).
            </p>
          </div>
          <div>
            <h3 className="font-semibold">
              Deploy fails on a Durable Object binding
            </h3>
            <p className="text-muted-foreground text-sm">
              An error about a missing script or Durable Object class when
              deploying <code className="bg-muted px-1 rounded">pvtch</code>{' '}
              means storage isn't deployed yet, or is older than the app. Run{' '}
              <code className="bg-muted px-1 rounded">
                pnpm --filter @pvtch/storage deploy
              </code>{' '}
              and deploy the app again.
            </p>
          </div>
          <div>
            <h3 className="font-semibold">Durable Objects not working</h3>
            <p className="text-muted-foreground text-sm">
              Durable Objects are automatically created on first deploy. If you
              see errors, try running{' '}
              <code className="bg-muted px-1 rounded">wrangler deploy</code>{' '}
              again.
            </p>
          </div>
          <div>
            <h3 className="font-semibold">Translation not working</h3>
            <p className="text-muted-foreground text-sm">
              Workers AI is enabled by default. Make sure your Cloudflare
              account has AI enabled (it's in the free tier).
            </p>
          </div>
        </div>
      </div>

      {/* Help */}
      <div className="p-6 rounded-xl border border-border bg-card text-center">
        <h2 className="text-xl font-semibold mb-2">Need Help?</h2>
        <p className="text-muted-foreground mb-4">
          If you run into issues or have questions, open an issue on GitHub.
        </p>
        <Button variant="outline" className="gap-2" asChild>
          <a
            href="https://github.com/thecodedrift/pvtch/issues"
            target="_blank"
            rel="noopener noreferrer"
          >
            <GithubIcon className="size-4" />
            Open an Issue
            <ExternalLink className="size-4" />
          </a>
        </Button>
      </div>
    </div>
  );
}
