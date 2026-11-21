import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'));

test('Vercel rewrites keep /api/* away from the SPA fallback', () => {
  const rewrites = Array.isArray(config.rewrites) ? config.rewrites : [];
  assert.ok(rewrites.some((rule) => rule.source === '/api/(.*)'), 'API rewrites must be defined before the SPA fallback.');
  const apiIndex = rewrites.findIndex((rule) => rule.source === '/api/(.*)');
  const spaIndex = rewrites.findIndex((rule) => rule.source === '/(.*)');
  assert.ok(apiIndex >= 0, 'Expected an API rewrite rule.');
  assert.ok(spaIndex >= 0, 'Expected a SPA fallback rewrite.');
  assert.ok(apiIndex < spaIndex, 'The API rewrite must be evaluated before the SPA fallback.');
});

test('The public intake form is routed before the SPA fallback (no login needed)', () => {
  const rewrites = config.rewrites;
  const spaIndex = rewrites.findIndex((rule) => rule.source === '/(.*)');
  for (const source of ['/intake', '/intake/']) {
    const index = rewrites.findIndex((rule) => rule.source === source && rule.destination === '/intake/index.html');
    assert.ok(index >= 0 && index < spaIndex, `${source} must serve the static form before the SPA fallback.`);
  }
});
