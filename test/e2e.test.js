// Runs Jaanch (rules mode) against the ChaiCart demo and checks every planted bug is found.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findBrowser } from '../src/browser.js';
import { createServer } from '../demo/server.js';
import { main } from '../src/cli.js';

test('finds all planted bugs in the demo shop', { skip: !findBrowser() && 'no Chromium-based browser installed', timeout: 120000 }, async () => {
  const server = createServer().listen(0);
  await new Promise((r) => server.once('listening', r));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'jaanch-'));
  const log = console.log;
  console.log = () => {};
  try {
    process.env.JAANCH_OFFLINE = '1';
    const code = await main([`http://127.0.0.1:${server.address().port}`, '--out', out, '--steps', '30', '--fail-on', 'high']);
    assert.equal(code, 1, '--fail-on high should fail when high bugs exist');
  } finally {
    console.log = log;
    server.close();
  }
  const report = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8'));
  const messages = report.issues.map((i) => i.message).join('\n');
  for (const expected of [/reading 'toFixed'/, /setting 'textContent'/, /exportCsv is not defined/, /\/api\/orders returned 500/, /\/pricing returned 404/, /hero-chai\.png returned 404/]) {
    assert.match(messages, expected);
  }
  assert.ok(!report.steps.some((s) => /Delete account/.test(s.description)), 'must never click Delete account');
  assert.ok(fs.existsSync(path.join(out, 'report.html')));
  assert.ok(fs.existsSync(path.join(out, 'jaanch.spec.js')));
});
