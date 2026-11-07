import type { V2Config } from '../lingo/config-v2';
import type { EvalFixture } from './eval-fixtures';

/** Models must be `provider/model`; matches the route's check. */
const MODEL_PATTERN = String.raw`\s*[^\s/]+/\S+\s*`;

function pairFields(pair: string, defaults: V2Config): string {
  const selected = (api: V2Config['detectorApi']) =>
    defaults.detectorApi === api ? ' selected' : '';
  return `
  <label>Detector model <input id="${pair}-detectorModel" required pattern="${MODEL_PATTERN}" title="provider/model" value="${defaults.detectorModel}"></label>
  <label>Detector API
    <select id="${pair}-detectorApi">
      <option value="decisions"${selected('decisions')}>decisions</option>
      <option value="chat"${selected('chat')}>chat</option>
    </select>
  </label>
  <label>Max "is English" score <input id="${pair}-maxTargetProbability" type="number" min="0" max="1" step="0.01" value="${defaults.maxTargetProbability}"></label>
  <label>Translator model <input id="${pair}-translatorModel" required pattern="${MODEL_PATTERN}" title="provider/model" value="${defaults.translatorModel}"></label>`;
}

/** The v2 eval table. Results are written with textContent, so model output
 * can't inject markup. */
export function evalsPage(
  fixtures: readonly EvalFixture[],
  defaults: V2Config
): string {
  const data = JSON.stringify(fixtures).replaceAll('<', String.raw`<`);

  return `<!doctype html>
<meta charset="utf-8">
<title>Lingual v2 evals</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px system-ui, sans-serif; margin: 2rem auto; max-width: 96rem; padding: 0 1rem; }
  textarea { box-sizing: border-box; display: block; font: inherit; height: 5rem; margin-top: .25rem; width: 100%; }
  fieldset { border: 1px solid #8884; display: grid; flex: 1 1 24rem; gap: .5rem; }
  fieldset label { display: grid; gap: .15rem; }
  fieldset label.inline { align-items: center; display: flex; gap: .4rem; }
  fieldset input:not([type="checkbox"]), fieldset select { box-sizing: border-box; font: inherit; width: 100%; }
  table { border-collapse: collapse; margin-top: 1.5rem; width: 100%; }
  td, th { border-bottom: 1px solid #8884; padding: .5rem; text-align: left; vertical-align: top; }
  .wide { min-width: 16rem; overflow-wrap: anywhere; }
  .pairs, .controls { align-items: flex-start; display: flex; flex-wrap: wrap; gap: 1rem; margin: 1rem 0; }
  .controls { align-items: center; }
  .note { color: #888; font-size: 13px; }
  .bad { background: #d3300022; }
  .chosen { font-weight: 700; outline: 2px solid currentColor; }
</style>
<h1>Lingual v2 evals</h1>
<p class="note">Runs the real v2 path into English with live OpenRouter calls. Nothing is posted to Twitch. Model settings apply to this run only, and scores are model-specific, so each detector needs its own threshold. <a href="/">Back to the harness</a></p>
<div class="pairs">
  <fieldset id="a"><legend>Pair A</legend>${pairFields('a', defaults)}</fieldset>
  <fieldset id="b"><legend><label class="inline"><input id="useB" type="checkbox"> Pair B</label></legend>${pairFields('b', defaults)}</fieldset>
</div>
<label>Extra messages, one per line
  <textarea id="extra"></textarea>
</label>
<div class="controls">
  <button id="run">Run evals</button>
  <span id="summary" class="note"></span>
</div>
<table hidden id="results">
  <thead><tr>
    <th>#</th><th>Message</th><th>Expected</th><th>Pair</th><th>Not English</th><th>Result</th><th>Translation</th><th>Mentions and emotes</th><th>ms</th><th>Auto</th><th>Your call</th>
  </tr></thead>
  <tbody></tbody>
</table>
<script>
  const fixtures = ${data};
  const CONCURRENCY = 4;
  const RETRIES = 3;
  const RETRY_DELAY_MS = 2000;
  const COLUMNS_AFTER_PAIR = 7;
  const byId = (id) => document.querySelector('#' + id);
  let pairs = [];
  let runs = [];

  const cell = (row, text, className) => {
    const td = row.insertCell();
    td.textContent = text ?? '';
    if (className) td.className = className;
    return td;
  };

  const shortName = (model) => model.split('/').pop();

  const readPair = (id) => {
    const value = (field) => byId(id + '-' + field).value;
    const config = {
      detectorApi: value('detectorApi'),
      detectorModel: value('detectorModel').trim(),
      translatorModel: value('translatorModel').trim(),
      maxTargetProbability: Number(value('maxTargetProbability')),
    };
    const threshold = config.maxTargetProbability;
    const label = id.toUpperCase() + ': ' + shortName(config.detectorModel) + ' at ' + threshold + ' + ' + shortName(config.translatorModel);
    return { id, label, config };
  };

  const summarize = () => {
    byId('summary').textContent = pairs.map((pair) => {
      const own = runs.filter((run) => run.pair === pair);
      const count = (test) => own.filter(test).length;
      return pair.id.toUpperCase() + ': ' + count((run) => run.done) + ' of ' + own.length + ' done, '
        + count((run) => run.auto === true) + ' matched, ' + count((run) => run.auto === false) + ' did not, '
        + count((run) => run.failed) + ' failed, you said ' + count((run) => run.verdict === 'Right') + ' right, '
        + count((run) => run.verdict === 'Wrong') + ' wrong.';
    }).join(' ');
  };

  const verdictButtons = (td, run) => {
    for (const label of ['Right', 'Wrong']) {
      const button = document.createElement('button');
      button.textContent = label;
      button.addEventListener('click', () => {
        run.verdict = label;
        for (const other of td.children) other.classList.toggle('chosen', other === button);
        summarize();
      });
      td.append(button);
    }
  };

  const checkTokens = (fixture, reply) => {
    if (!reply || fixture.keep.length === 0) return '';
    const wrong = fixture.keep.filter((token) => reply.includes(token) !== token.startsWith('@'));
    return wrong.length === 0 ? 'OK' : 'Check ' + wrong.join(', ');
  };

  /** wrangler dev drops connections while it reloads, so retry those. */
  const postEval = async (fixture, config, attemptsLeft = RETRIES) => {
    try {
      return await fetch('/evals/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: fixture.text,
          emotes: fixture.keep.filter((token) => !token.startsWith('@')),
          config,
        }),
      });
    } catch (error) {
      if (attemptsLeft === 0) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return postEval(fixture, config, attemptsLeft - 1);
    }
  };

  const showFailure = (run, message) => {
    run.failed = true;
    run.row.classList.add('bad');
    cell(run.row, message).colSpan = COLUMNS_AFTER_PAIR;
  };

  const runOne = async (run) => {
    const { fixture, pair, row } = run;
    try {
      const response = await postEval(fixture, pair.config);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const trace = await response.json();
      if (trace.outcome.endsWith('-failed')) {
        showFailure(run, trace.outcome + ': ' + (trace.error ?? 'no usable answer'));
      } else {
        const translated = trace.outcome === 'translated';
        cell(row, trace.probability === undefined ? '' : Math.round((1 - trace.probability) * 100) + '%');
        cell(row, trace.outcome);
        cell(row, trace.translation, 'wide');
        const tokens = checkTokens(fixture, trace.reply);
        cell(row, tokens);
        cell(row, trace.ms);
        if (fixture.expected === 'translate' || fixture.expected === 'quiet') {
          run.auto = translated === (fixture.expected === 'translate') && !tokens.startsWith('Check');
        }
        cell(row, run.auto === undefined ? 'Review' : (run.auto ? 'Match' : 'Mismatch'));
        row.classList.toggle('bad', run.auto === false);
        verdictButtons(row.insertCell(), run);
      }
    } catch (error) {
      showFailure(run, 'Request failed: ' + error.message + '. Run again.');
    }
    run.done = true;
    summarize();
  };

  byId('run').addEventListener('click', async () => {
    const ids = byId('useB').checked ? ['a', 'b'] : ['a'];
    const modelInputs = ids.flatMap((id) => [byId(id + '-detectorModel'), byId(id + '-translatorModel')]);
    if (!modelInputs.every((input) => input.reportValidity())) return;

    const button = byId('run');
    button.disabled = true;
    const tbody = byId('results').tBodies[0];
    tbody.replaceChildren();
    byId('results').hidden = false;

    pairs = byId('useB').checked ? [readPair('a'), readPair('b')] : [readPair('a')];
    const extra = byId('extra').value.split('\\n').map((line) => line.trim()).filter(Boolean)
      .map((text) => ({ text, expected: 'either', note: 'Added by hand', keep: [] }));

    runs = [];
    for (const [index, fixture] of [...fixtures, ...extra].entries()) {
      for (const [position, pair] of pairs.entries()) {
        const row = tbody.insertRow();
        if (position === 0) {
          cell(row, index + 1).rowSpan = pairs.length;
          const message = cell(row, fixture.text, 'wide');
          message.rowSpan = pairs.length;
          const note = document.createElement('div');
          note.className = 'note';
          note.textContent = fixture.note;
          message.append(note);
          cell(row, fixture.expected).rowSpan = pairs.length;
        }
        cell(row, pair.label);
        runs.push({ fixture, pair, row, done: false });
      }
    }
    summarize();

    const queue = [...runs];
    const worker = async () => {
      while (queue.length > 0) await runOne(queue.shift());
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    button.disabled = false;
  });
</script>
`;
}
