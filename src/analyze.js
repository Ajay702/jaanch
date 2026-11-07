// Turns raw issues into bug reports a developer can act on: title, severity, what the user
// sees, likely cause and a suggested fix. Uses BharatCode AI when available, rules otherwise.
import { askJSON } from './ai.js';
import { shortUrl } from './collector.js';

const SEVERITY = { high: 0, medium: 1, low: 2 };

export function ruleSeverity(issue) {
  switch (issue.kind) {
    case 'js-exception':
      return 'high';
    case 'broken-page':
    case 'http-error':
      return issue.status >= 500 ? 'high' : 'medium';
    case 'request-failed':
    case 'console-error':
    case 'broken-image':
    case 'unclickable':
      return 'medium';
    default:
      return 'low';
  }
}

const FALLBACK = {
  'js-exception': (i) => ({
    title: `JavaScript crash: ${i.message.slice(0, 80)}`,
    whatUserSees: 'The action silently does nothing or the page stops responding.',
    likelyCause: i.source ? `An uncaught error thrown at ${shortUrl(i.source.url)}:${i.source.line}.` : 'An uncaught error in page JavaScript.',
    suggestedFix: 'Open the file at the line shown, check for null/undefined values and misspelled IDs or functions, and guard or fix the reference.',
  }),
  'console-error': (i) => ({
    title: `Console error: ${i.message.slice(0, 80)}`,
    whatUserSees: 'Possibly nothing visible, but something on the page failed.',
    likelyCause: 'Code logged an error with console.error or a library reported a problem.',
    suggestedFix: 'Read the full message in DevTools and handle the failing case.',
  }),
  'broken-page': (i) => ({
    title: `Page ${shortUrl(i.url)} returns ${i.status}`,
    whatUserSees: i.status === 404 ? 'A "Not found" page after clicking a link.' : 'An error page instead of content.',
    likelyCause: i.status === 404 ? 'A link points to a route that does not exist.' : 'The server threw an error while rendering this page.',
    suggestedFix: i.status === 404 ? 'Create the route, or fix/remove the links that point to it.' : 'Check the server logs for this route.',
  }),
  'http-error': (i) => ({
    title: `${i.method} ${shortUrl(i.url)} fails with ${i.status}`,
    whatUserSees: 'Data that depends on this request never appears, or a spinner never stops.',
    likelyCause: i.status >= 500 ? 'The API handler throws an error on the server.' : 'The request is wrong (missing route, auth or bad payload).',
    suggestedFix: i.status >= 500 ? 'Check server logs for this endpoint and handle the error; show the user a message on failure.' : 'Check the URL, method and payload, and handle non-OK responses in the client.',
  }),
  'request-failed': (i) => ({
    title: `Request never completed: ${shortUrl(i.url)}`,
    whatUserSees: 'Missing data or a stuck loading state.',
    likelyCause: 'The server is unreachable, the connection was refused or CORS blocked it.',
    suggestedFix: 'Check that the endpoint is up and reachable from the browser.',
  }),
  'broken-image': (i) => ({
    title: `Broken image: ${shortUrl(i.url)}`,
    whatUserSees: 'A broken-image icon or an empty gap.',
    likelyCause: 'The image path is wrong or the file was not deployed.',
    suggestedFix: 'Fix the src path or add the missing file to your static assets.',
  }),
  unclickable: (i) => ({
    title: i.message.split(':')[0],
    whatUserSees: 'Clicking the control does nothing because something covers it.',
    likelyCause: 'Another element overlaps it, or it is off-screen.',
    suggestedFix: 'Check z-index/positioning of overlays and make sure the control is reachable.',
  }),
  a11y: (i) => ({
    title: i.message,
    whatUserSees: 'Screen-reader and keyboard users get no description for this element.',
    likelyCause: 'Missing alt text, <label>, or aria-label.',
    suggestedFix: 'Add alt text to images, a <label for> or aria-label to inputs, and text to buttons.',
  }),
};

function fallbackFor(issue) {
  const f = (FALLBACK[issue.kind] ?? FALLBACK['console-error'])(issue);
  return { ...f, severity: ruleSeverity(issue), by: 'rules' };
}

/** Fetches a few lines of source around the error location (same-origin only). */
async function sourceSnippet(source, origin) {
  if (!source?.url || !source.line) return null;
  try {
    if (new URL(source.url).origin !== origin) return null;
    const res = await fetch(source.url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const lines = (await res.text()).split('\n');
    if (lines.length === 1 && lines[0].length > 400) return null; // minified bundle, not useful
    const from = Math.max(0, source.line - 5);
    const to = Math.min(lines.length, source.line + 3);
    return lines
      .slice(from, to)
      .map((l, i) => `${String(from + i + 1).padStart(4)}${from + i + 1 === source.line ? ' >' : '  '} ${l.slice(0, 160)}`)
      .join('\n');
  } catch {
    return null;
  }
}

const BUGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['bugs'],
  properties: {
    bugs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'severity', 'whatUserSees', 'likelyCause', 'suggestedFix'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string', description: 'Short bug title, max 70 chars' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          whatUserSees: { type: 'string', description: 'One sentence, plain language' },
          likelyCause: { type: 'string', description: 'One or two sentences, reference file:line when known' },
          suggestedFix: { type: 'string', description: 'Concrete fix; include a small code snippet when the source is given' },
        },
      },
    },
  },
};

const BUGS_INSTRUCTIONS = `You are Jaanch, a senior QA engineer writing bug reports for a developer.
For each issue, write a short title, a severity (high = feature broken or crash; medium = degraded; low = cosmetic/accessibility),
what the end user experiences, the most likely root cause and a concrete fix.
Use the source snippet when provided: the line marked ">" is where the error was thrown. Quote the exact identifier that is wrong.
Be specific and brief. Do not invent files that are not mentioned. Return one entry per issue id, in the same order.`;

export async function analyze({ issues, steps, origin, useAI, log }) {
  // Attach repro steps and source context.
  for (const issue of issues) {
    issue.repro = steps.filter((s) => s.n <= issue.step).map((s) => s.description);
    issue.snippet = await sourceSnippet(issue.source, origin);
    Object.assign(issue, fallbackFor(issue));
  }

  const important = issues.filter((i) => i.kind !== 'a11y').slice(0, 15);
  if (useAI && important.length) {
    const input = important
      .map((i) =>
        [
          `### ${i.id} (${i.kind})`,
          `Message: ${i.message}`,
          `Page: ${shortUrl(i.pageUrl)}`,
          `Steps to reproduce: ${i.repro.slice(-6).join(' → ')}`,
          i.snippet ? `Source (${shortUrl(i.source.url)}):\n${i.snippet}` : '',
          i.stack ? `Stack:\n${i.stack}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      )
      .join('\n\n');
    try {
      log.info(`Asking BharatCode AI to explain ${important.length} issue(s)…`);
      const out = await askJSON({ name: 'bug_reports', instructions: BUGS_INSTRUCTIONS, input, schema: BUGS_SCHEMA, maxTokens: 6000, effort: 'low', stage: 'explain' });
      const byId = new Map(out.bugs.map((b) => [b.id, b]));
      for (const issue of important) {
        const b = byId.get(issue.id);
        if (!b) continue;
        Object.assign(issue, {
          title: b.title || issue.title,
          severity: SEVERITY[b.severity] !== undefined ? b.severity : issue.severity,
          whatUserSees: b.whatUserSees || issue.whatUserSees,
          likelyCause: b.likelyCause || issue.likelyCause,
          suggestedFix: b.suggestedFix || issue.suggestedFix,
          by: 'ai',
        });
      }
    } catch (err) {
      log.warn(`AI explanations unavailable (${err.message}); using built-in explanations`);
    }
  }

  issues.sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity] || a.step - b.step);
  return issues;
}
