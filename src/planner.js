// Decides what to do next. Builds a safe list of candidate actions from the page, then either
// lets the BharatCode model pick one (AI mode) or takes the first by a simple priority (offline).
import { describe } from './snapshot.js';
import { askJSON } from './ai.js';

// Never click things that could destroy data or end the session.
export const DANGEROUS = /\b(log ?out|sign ?out|delete|remove|destroy|deactivate|unsubscribe|cancel (my )?(account|subscription)|pay now|place order|purchase|buy now)\b/i;

export function sampleValue(el) {
  const hint = `${el.type} ${el.name} ${el.label} ${el.placeholder} ${el.domId}`.toLowerCase();
  if (el.type === 'email' || hint.includes('email')) return 'asha.verma@example.com';
  if (el.type === 'password' || hint.includes('password')) return 'Jaanch@2026';
  if (el.type === 'tel' || /phone|mobile/.test(hint)) return '9876543210';
  if (el.type === 'number' || /age|qty|quantity|amount|count/.test(hint)) return '3';
  if (el.type === 'url' || /website|url/.test(hint)) return 'https://example.com';
  if (el.type === 'date') return '2026-11-10';
  if (/pin ?code|zip|postal/.test(hint)) return '560001';
  if (/city/.test(hint)) return 'Bengaluru';
  if (/search|query/.test(hint)) return 'test';
  if (/name/.test(hint)) return 'Asha Verma';
  if (el.tag === 'textarea' || /message|comment|bio|description/.test(hint)) return 'Testing this form with Jaanch.';
  return 'jaanch test';
}

const pathKey = (url) => {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
};
export const elementKey = (url, el) => `${pathKey(url)}|${el.tag}|${el.type}|${el.text || el.label || el.name || el.placeholder || el.href || el.domId}`;

/**
 * Candidate actions for the current page, in default priority order:
 * fill empty form fields → submit that form → click untried buttons → open unvisited links → revisit frontier.
 */
export function candidates(snap, mem) {
  const out = [];
  const origin = new URL(mem.startUrl).origin;
  const fillable = (e) => ['input', 'textarea'].includes(e.tag) && !['submit', 'button', 'checkbox', 'radio', 'file', 'reset', 'image'].includes(e.type);

  for (const el of snap.elements) {
    if (fillable(el) && !el.value && !mem.tried.has(elementKey(snap.url, el))) {
      out.push({ type: 'fill', el, value: sampleValue(el), why: 'fill empty form field' });
    }
  }
  for (const el of snap.elements) {
    if (el.tag === 'select' && !mem.tried.has(elementKey(snap.url, el))) out.push({ type: 'select', el, why: 'choose an option' });
  }
  const isButton = (e) => e.tag === 'button' || ['submit', 'button'].includes(e.type) || e.role === 'button' || (e.tag !== 'a' && !fillable(e) && e.tag !== 'select');
  for (const el of snap.elements) {
    if (!isButton(el) || mem.tried.has(elementKey(snap.url, el))) continue;
    if (DANGEROUS.test(`${el.text} ${el.label}`)) continue;
    out.push({ type: 'click', el, why: el.formKey ? 'submit the form' : 'try this button' });
  }
  for (const el of snap.elements) {
    if (el.tag !== 'a' || !el.href || mem.tried.has(elementKey(snap.url, el))) continue;
    let u;
    try {
      u = new URL(el.href);
    } catch {
      continue;
    }
    if (u.origin !== origin || !/^https?:$/.test(u.protocol) || DANGEROUS.test(el.text)) continue;
    const target = u.origin + u.pathname + u.search;
    if (target === snap.url.split('#')[0] && u.hash) continue; // same-page anchor
    out.push({ type: 'click', el, why: mem.visited.has(target) ? 'link to a visited page' : 'open a new page', fresh: !mem.visited.has(target) });
  }
  // Prefer links to pages we have not seen yet over links to visited pages.
  out.sort((a, b) => rank(a) - rank(b));
  // Remember how much is left to try here, so we can come back if we leave early.
  const here = pathKey(snap.url);
  mem.untried ??= new Map();
  mem.untried.set(here, out.filter((c) => c.el.tag !== 'a' || c.fresh).length);
  for (const url of mem.frontier) {
    if (!mem.visited.has(url)) out.push({ type: 'goto', url, why: 'visit a page seen earlier' });
  }
  for (const [p, left] of mem.untried) {
    if (p !== here && left > 0) out.push({ type: 'goto', url: origin + p, why: `go back: ${left} untried action(s) there`, revisit: true });
  }
  return out.slice(0, 40);
}

function rank(c) {
  if (c.type === 'fill' || c.type === 'select') return 0;
  if (c.type === 'click' && c.el.tag !== 'a') return c.el.formKey ? 1 : 2;
  if (c.type === 'click' && c.fresh) return 3;
  return 4;
}

export function describeAction(c) {
  if (c.type === 'fill') return `type "${c.value}" into ${describe(c.el)}`;
  if (c.type === 'select') return `pick an option in ${describe(c.el)}`;
  if (c.type === 'click') return `click ${describe(c.el)}`;
  if (c.type === 'goto') return `go to ${pathKey(c.url)}`;
  return c.type;
}

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['choice', 'value', 'reason'],
  properties: {
    choice: { type: 'integer', description: 'Index of the chosen action, or -1 to stop exploring' },
    value: { type: 'string', description: 'Text to type for fill actions; empty string otherwise' },
    reason: { type: 'string', description: 'One short sentence' },
  },
};

const PLAN_INSTRUCTIONS = `You are Jaanch, a careful QA tester exploring a web app to find bugs.
Pick the ONE next action most likely to uncover a bug or reach an untested feature.
Rules:
- Only choose from the numbered actions given. Return its index.
- Behave like a real Indian user: realistic names, emails, phone numbers, PIN codes.
- Fill required fields before submitting a form. Try each form and button once.
- Prefer new pages and features over ones already visited.
- Try every button on a page before leaving it; each button may hide a different bug.
- Use "go back" actions to finish pages you left early.
- Return -1 only when every action has been tried or nothing useful is left.
- For fill actions, put the text to type in "value"; otherwise value is "".`;

export class Planner {
  constructor({ useAI, log }) {
    this.useAI = useAI;
    this.log = log;
    this.aiFailures = 0;
  }

  async next(snap, mem) {
    const list = candidates(snap, mem);
    if (!list.length) return null;
    if (!this.useAI || this.aiFailures >= 3) return { ...list[0], reason: list[0].why, by: 'rules' };

    const numbered = list.map((c, i) => `${i}. ${describeAction(c)}${c.el?.required ? ' (required)' : ''}`).join('\n');
    const recent = mem.history.slice(-8).map((h) => `- ${h.description}${h.newIssues ? ` → ${h.newIssues} new issue(s)` : ''}`).join('\n') || '- (nothing yet)';
    const input = `Page: ${snap.title || '(untitled)'} — ${snap.url}
Visible text (truncated): ${snap.text.slice(0, 600)}

Recent steps:
${recent}

Issues found so far: ${mem.issueCount}
Pages visited: ${[...mem.visited].map(pathKey).join(', ')}

Possible actions:
${numbered}`;
    try {
      const out = await askJSON({ name: 'next_action', instructions: PLAN_INSTRUCTIONS, input, schema: PLAN_SCHEMA, maxTokens: 400, stage: 'plan' });
      // The model may want to stop early; keep going while anything is left to try.
      if (out.choice === -1) return { ...list[0], reason: `${list[0].why} (AI wanted to stop; still untried actions)`, by: 'rules' };
      const chosen = list[out.choice];
      if (!chosen) throw new Error(`model picked invalid index ${out.choice}`);
      const value = chosen.type === 'fill' && out.value ? out.value.slice(0, 200) : chosen.value;
      return { ...chosen, value, reason: out.reason, by: 'ai' };
    } catch (err) {
      this.aiFailures += 1;
      this.log.warn(`AI planner unavailable (${err.message}); using rules for this step`);
      return { ...list[0], reason: list[0].why, by: 'rules' };
    }
  }
}
