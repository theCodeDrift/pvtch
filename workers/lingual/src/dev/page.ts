/** The harness form. */
export function harnessPage(): string {
  return `<!doctype html>
<meta charset="utf-8">
<title>Lingual harness</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px system-ui, sans-serif; margin: 2rem auto; max-width: 36rem; padding: 0 1rem; }
  label { display: block; margin-bottom: 1rem; }
  input, select, textarea { box-sizing: border-box; display: block; font: inherit; margin-top: .25rem; width: 100%; }
  textarea { height: 6rem; }
  .note { color: #888; font-size: 13px; }
</style>
<h1>Lingual harness</h1>
<p class="note">Dev only. Translates into English and posts a real message to Twitch chat as botlingual. <a href="/evals">v2 evals</a></p>
<form id="form">
  <label>User ID (the broadcaster's numeric Twitch ID)
    <input id="broadcasterId" inputmode="numeric" pattern="[0-9]+" required>
  </label>
  <label>Message
    <textarea id="text" maxlength="500" required></textarea>
  </label>
  <label>Translation flow
    <select id="flow">
      <option value="v2">v2: OpenRouter (Decider detection, Gemma)</option>
      <option value="v1">v1: Workers AI (local classifiers)</option>
    </select>
  </label>
  <button>Send</button>
  <p id="status" class="note"></p>
</form>
<script>
  const byId = (id) => document.querySelector('#' + id);
  byId('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const response = await fetch('/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        broadcasterId: byId('broadcasterId').value,
        text: byId('text').value,
        flow: byId('flow').value,
      }),
    });
    byId('status').textContent = response.ok
      ? 'Queued. Watch Twitch chat and the terminal.'
      : 'Failed: ' + response.status;
  });
</script>
`;
}
