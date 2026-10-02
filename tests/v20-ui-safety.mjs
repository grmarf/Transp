import assert from 'node:assert/strict';
import { escapeHtml } from '../src/html.js';

const payloads = [
  '<img src=x onerror=alert(1)>',
  '" onmouseover="alert(1)',
  "</div><script>alert('x')</script>",
  '&lt;script&gt;'
];

for (const payload of payloads) {
  const escaped = escapeHtml(payload);
  assert.equal(escaped.includes('<'), false, `balise non échappée pour ${payload}`);
  assert.equal(escaped.includes('>'), false, `fermeture non échappée pour ${payload}`);
  assert.equal(escaped.includes('"'), false, `guillemet non échappé pour ${payload}`);
  assert.equal(escaped.includes("'"), false, `apostrophe non échappée pour ${payload}`);
  assert.equal(escaped.includes(payload), false, `payload présent en clair pour ${payload}`);
}

assert.equal(
  escapeHtml("Ligne <Sud> & l'Ouest"),
  "Ligne &lt;Sud&gt; &amp; l&#39;Ouest"
);
assert.equal(escapeHtml(null), '');
assert.equal(escapeHtml(undefined), '');
assert.equal(escapeHtml(42), '42');

console.log(JSON.stringify({ ok: true, payloads: payloads.length }));
