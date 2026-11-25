import { Link } from 'react-router';
import { LlmBadge } from '@/components/llm-badge';

const REPO = 'https://github.com/thecodedrift/pvtch';
const LINGUAL_SOURCE = `${REPO}/tree/main/workers/lingual`;
const EVAL_FIXTURES = `${REPO}/blob/main/workers/lingual/src/dev/eval-fixtures.ts`;
const EVAL_HARNESS = `${REPO}/blob/main/workers/lingual/README.md#dev-harness`;
const MODEL_CONFIG = `${REPO}/blob/main/workers/lingual/wrangler.jsonc`;

// Keep in step with LINGUAL_V2_* in workers/lingual/wrangler.jsonc and
// PRIVATE_ROUTING in workers/lingual/src/lingo/openrouter.ts.
const LINGUAL_MODELS = [
  {
    job: 'Language detection',
    model: 'Perplexity pplx-decider-v1.2',
    id: 'perplexity/pplx-decider-v1.2',
    does: 'Scores how likely it is that a message is already entirely in your language. Lingual only translates when that score is very low.',
  },
  {
    job: 'Translation',
    model: 'Google Gemma 3 12B Instruct',
    id: 'google/gemma-3-12b-it',
    does: 'Translates the message into your language. Its answer must match a fixed schema: the translation and nothing else.',
  },
];

const LAST_UPDATED = 'November 25, 2026';

export function meta() {
  return [
    { title: 'How PVTCH uses LLMs' },
    {
      name: 'description',
      content:
        'Where PVTCH uses large language models, which models and providers, how we evaluate them, and what happens to your chat.',
    },
  ];
}

function External({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export default function LlmUse() {
  return (
    <div className="prose dark:prose-invert max-w-none">
      <h1>How PVTCH uses LLMs</h1>
      <p className="text-muted-foreground">
        Last updated {LAST_UPDATED}. This page changes whenever what it
        describes changes.
      </p>

      <p>
        Large language models can do genuinely good things for a stream. A
        viewer typing in Tagalog or Korean can be part of the conversation
        instead of being skipped over. Used carelessly, the same technology
        floods chats with spam, puts words in people&apos;s mouths, invents
        facts, and quietly collects what communities say to each other.
      </p>
      <p>
        We think both of those are true, so we would rather tell you exactly
        where PVTCH uses LLMs than ask you to trust us. Every feature that uses
        one carries this label, which links back here:
      </p>
      <p className="not-prose">
        <LlmBadge />
      </p>

      <h2>What we hold ourselves to</h2>
      <ul>
        <li>
          <strong>Labeled.</strong> Any feature that sends anything to an LLM
          carries the LLM powered label and is listed on this page.
        </li>
        <li>
          <strong>Opt in.</strong> LLM features are off until a streamer turns
          them on for their own channel.
        </li>
        <li>
          <strong>Never speaks for anyone.</strong> An LLM in PVTCH only
          transforms what a person already wrote. It doesn&apos;t start
          conversations, answer chatters, write messages in anyone&apos;s name,
          or moderate anyone.
        </li>
        <li>
          <strong>Quiet when unsure.</strong> When a model is uncertain or a
          call fails, the feature does nothing rather than guess.
        </li>
        <li>
          <strong>Your chat isn&apos;t training data.</strong> We only route to
          providers that keep no copy of the request and don&apos;t train on it
          (more on that below).
        </li>
        <li>
          <strong>Open to inspection.</strong> The prompts, the model choices,
          and the evaluation cases are all in the{' '}
          <External href={REPO}>source on GitHub</External>.
        </li>
      </ul>

      <h2>Where we use LLMs</h2>

      <h3>
        <Link to="/bots/lingual">Lingual</Link> (preview)
      </h3>
      <p>
        Lingual is a chat bot that translates messages that aren&apos;t in the
        streamer&apos;s language, replying in a thread under the original.
        Chatters can also ask for a translation with the channel&apos;s
        translate command. Each message goes through two models:
      </p>
      <div className="not-prose overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="py-2 pr-4 font-semibold">Job</th>
              <th className="py-2 pr-4 font-semibold">Model</th>
              <th className="py-2 font-semibold">What it does</th>
            </tr>
          </thead>
          <tbody>
            {LINGUAL_MODELS.map((row) => (
              <tr key={row.id} className="border-b border-border align-top">
                <td className="py-2 pr-4">{row.job}</td>
                <td className="py-2 pr-4">
                  {row.model}
                  <div className="text-xs text-muted-foreground">
                    <code>{row.id}</code>
                  </div>
                </td>
                <td className="py-2 text-zinc-600 dark:text-zinc-400">
                  {row.does}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        <strong>What the models see:</strong> the text of one message and the
        name of the target language. For automatic translations, Twitch emotes,
        cheermotes and links are removed first (@mentions stay, so the
        translation keeps them). With the translate command, the models get the
        text the chatter typed after the command. They don&apos;t receive the
        chatter&apos;s username, the channel name, or any other messages.
      </p>
      <p>
        <strong>Prompt injection:</strong> chat is untrusted text. The message
        is fenced off with a random tag on every request, the instructions say
        to treat it only as text to translate, and the answer must fit a fixed
        format. The models can&apos;t take any action; the worst a bad answer
        can do is be a bad translation.
      </p>

      <h3>Building PVTCH</h3>
      <p>
        We use AI coding assistants to help write and review PVTCH&apos;s code.
        A person reviews every change and is fully accountable for everything
        that ships, however it was written.
      </p>

      <h3>Everything else</h3>
      <p>
        The widgets (Board, Coworking Tasks, Progress Bar, Quick Poll), your
        account, and the rest of the site don&apos;t use LLMs. The retired Lingo
        translator did; Lingual replaces it.
      </p>

      <h2>Where your chat goes</h2>
      <ul>
        <li>
          <strong>Provider routing.</strong> Requests go through{' '}
          <External href="https://openrouter.ai">OpenRouter</External>, which
          forwards them to a provider that hosts the model. Every request asks
          OpenRouter to use only endpoints with a{' '}
          <External href="https://openrouter.ai/docs/features/zdr">
            zero data retention
          </External>{' '}
          policy that don&apos;t collect prompts for training. If no such
          endpoint is available, the request fails and Lingual stays quiet; it
          never falls back to one that keeps data.
        </li>
        <li>
          <strong>Our logs.</strong> To debug and improve translations, Lingual
          logs the message text, the detection score and the translation to
          Cloudflare&apos;s Workers logs, which expire on their own after a few
          days. We don&apos;t copy them into a database, build profiles from
          them, or sell them.
        </li>
        <li>
          <strong>Repeat detection.</strong> So a raid or copypasta gets one
          translation instead of fifty, Lingual remembers a hash of recent
          messages in memory for a short window. It can&apos;t be turned back
          into the message.
        </li>
        <li>
          <strong>Turning it off.</strong> Disabling Lingual stops any more of
          your chat from being sent anywhere.
        </li>
      </ul>

      <h2>How we choose models and providers</h2>
      <p>In rough order of importance:</p>
      <ol>
        <li>
          <strong>Privacy.</strong> The model must be available from a provider
          with zero data retention. A model that&apos;s only offered by
          providers who keep or train on requests is out, however good it is.
          Lingual&apos;s current models were picked in part because every
          provider serving them offers zero data retention.
        </li>
        <li>
          <strong>Quality on real chat.</strong> Chat is short, slangy,
          multilingual and full of emote names. A model has to pass our
          evaluations (below), not a general benchmark.
        </li>
        <li>
          <strong>Speed.</strong> A translation that arrives after the
          conversation has moved on doesn&apos;t help anyone.
        </li>
        <li>
          <strong>Small and focused.</strong> We prefer the smallest model that
          does the job well. It&apos;s faster, cheaper to keep free, and uses
          less energy than reaching for the largest model available.
        </li>
        <li>
          <strong>Predictable output.</strong> The provider must honor
          structured output, so the answer is a translation or a score and
          nothing else.
        </li>
      </ol>
      <p>
        The models in use are set in{' '}
        <External href={MODEL_CONFIG}>Lingual&apos;s configuration</External>{' '}
        and this page is updated when they change.
      </p>

      <h2>How we evaluate</h2>
      <p>
        Before a model or threshold changes, we run it against a set of{' '}
        <External href={EVAL_FIXTURES}>evaluation cases</External>: real chat
        messages, each marked with whether it should be translated, left alone,
        or is a judgment call. They include the hard ones: English with emote
        names that look like foreign words, stretched-out reactions like
        &ldquo;haiiiiii&rdquo;, mixed-language sentences, loanwords like
        &ldquo;merci&rdquo;, and messages that try to give the model
        instructions.
      </p>
      <p>
        The <External href={EVAL_HARNESS}>evaluation harness</External> runs
        those cases through the same code path production uses, side by side for
        two model pairs, and a person reviews every result by hand. Automated
        tests cover the rest of the pipeline. Anyone running their own copy of
        PVTCH can run the same evaluations.
      </p>

      <h2>Hosting your own</h2>
      <p>
        If you <Link to="/howto/deploy-your-own">host your own PVTCH</Link>, LLM
        features use your own OpenRouter key and whatever models you configure.
        The routing rules above are in the{' '}
        <External href={LINGUAL_SOURCE}>Lingual source</External>; this page
        describes pvtch.com.
      </p>

      <h2>Questions or concerns</h2>
      <p>
        If something here is unclear, or you think we&apos;ve gotten something
        wrong, please{' '}
        <External href={`${REPO}/issues`}>open an issue on GitHub</External>.
      </p>
    </div>
  );
}
