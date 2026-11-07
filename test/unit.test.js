import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleValue, candidates, DANGEROUS } from '../src/planner.js';
import { locatorFor, describe } from '../src/snapshot.js';
import { parseJSON, outputText } from '../src/ai.js';
import { firstFrame, Collector } from '../src/collector.js';
import { generateTests, onPageRun } from '../src/testgen.js';
import { ruleSeverity } from '../src/analyze.js';

const el = (o) => ({ id: 'e0', tag: 'input', type: '', role: '', text: '', label: '', name: '', domId: '', placeholder: '', formKey: '', ...o });

test('sampleValue picks realistic Indian test data', () => {
  assert.equal(sampleValue(el({ type: 'email' })), 'asha.verma@example.com');
  assert.equal(sampleValue(el({ type: 'tel' })), '9876543210');
  assert.equal(sampleValue(el({ name: 'pincode' })), '560001');
  assert.equal(sampleValue(el({ label: 'Full name' })), 'Asha Verma');
});

test('dangerous controls are never offered', () => {
  for (const t of ['Delete account', 'Log out', 'Sign out', 'Pay now', 'Unsubscribe']) assert.ok(DANGEROUS.test(t), t);
  assert.ok(!DANGEROUS.test('Add to cart'));
  const mem = { startUrl: 'http://x.test/', tried: new Set(), visited: new Set(), frontier: [] };
  const snap = {
    url: 'http://x.test/',
    elements: [el({ id: 'a', tag: 'button', text: 'Delete account' }), el({ id: 'b', tag: 'button', text: 'Export CSV' }), el({ id: 'c', tag: 'a', text: 'Elsewhere', href: 'https://evil.example/' })],
  };
  const list = candidates(snap, mem);
  assert.deepEqual(list.map((c) => c.el.id), ['b']);
});

test('candidates fill fields before submitting', () => {
  const mem = { startUrl: 'http://x.test/', tried: new Set(), visited: new Set(), frontier: [] };
  const snap = { url: 'http://x.test/signup', elements: [el({ id: 's', tag: 'button', type: 'submit', text: 'Create', formKey: 'f' }), el({ id: 'n', name: 'name', formKey: 'f' })] };
  assert.deepEqual(candidates(snap, mem).map((c) => c.type + ':' + c.el.id), ['fill:n', 'click:s']);
});

test('locatorFor prefers stable selectors', () => {
  assert.equal(locatorFor(el({ domId: 'email' })), 'page.locator("#email")');
  assert.equal(locatorFor(el({ name: 'phone' })), 'page.locator("input[name=\\"phone\\"]")');
  assert.equal(locatorFor(el({ tag: 'button', text: 'Go' })), `page.getByRole('button', { name: "Go" }).first()`);
  assert.equal(describe(el({ tag: 'a', text: 'Menu' })), 'link "Menu"');
});

test('parseJSON tolerates fences and prose', () => {
  assert.deepEqual(parseJSON('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJSON('Sure! {"a":2} hope that helps'), { a: 2 });
  assert.throws(() => parseJSON('no json here'));
});

test('outputText reads Responses API payloads', () => {
  assert.equal(outputText({ output_text: 'hi' }), 'hi');
  assert.equal(outputText({ output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: '{"x":1}' }] }] }), '{"x":1}');
});

test('firstFrame parses stack locations', () => {
  assert.deepEqual(firstFrame('TypeError: x\n    at addToCart (http://localhost:4173/cart.js:7:23)'), { url: 'http://localhost:4173/cart.js', line: 7, column: 23 });
  assert.equal(firstFrame('no frames'), null);
});

test('collector dedupes repeated issues', () => {
  const c = new Collector('http://x.test');
  c.add({ kind: 'js-exception', message: 'boom' });
  c.add({ kind: 'js-exception', message: 'boom' });
  assert.equal(c.issues.length, 1);
  assert.equal(c.issues[0].occurrences, 2);
});

test('severity rules', () => {
  assert.equal(ruleSeverity({ kind: 'js-exception' }), 'high');
  assert.equal(ruleSeverity({ kind: 'http-error', status: 503 }), 'high');
  assert.equal(ruleSeverity({ kind: 'http-error', status: 404 }), 'medium');
  assert.equal(ruleSeverity({ kind: 'a11y' }), 'low');
});

test('generated tests replay only the steps on the bug page', () => {
  const steps = [
    { n: 0, type: 'goto', url: 'http://x.test/' },
    { n: 1, type: 'click', fromUrl: 'http://x.test/', locator: `page.getByRole('link', { name: "Signup" }).first()` },
    { n: 2, type: 'fill', fromUrl: 'http://x.test/signup', locator: 'page.locator("#name")', value: 'Asha' },
    { n: 3, type: 'click', fromUrl: 'http://x.test/signup', locator: `page.getByRole('button', { name: "Create" }).first()` },
  ];
  const issue = { id: 'B1', kind: 'js-exception', step: 3, pageUrl: 'http://x.test/signup', severity: 'high', title: 'crash', message: 'TypeError' };
  assert.deepEqual(onPageRun(steps, issue).map((s) => s.n), [2, 3]);
  const spec = generateTests({ issues: [issue], steps, startUrl: 'http://x.test/' });
  assert.match(spec, /page\.goto\(BASE_URL \+ "\/signup"\)/);
  assert.match(spec, /fill\("Asha"\)/);
  assert.doesNotMatch(spec, /name: "Signup"/);
  assert.match(spec, /expect\(errors/);
  assert.equal(generateTests({ issues: [{ ...issue, kind: 'a11y' }], steps, startUrl: 'http://x.test/' }), null);
});
