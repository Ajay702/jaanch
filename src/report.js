// Writes report.html (for humans) and report.json (for CI / other tools).
import fs from 'node:fs';
import path from 'node:path';
import { shortUrl } from './collector.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Light markdown for AI text: `code` and ```blocks```.
const md = (s) =>
  esc(s)
    .replace(/```[a-z]*\n?([\s\S]*?)```/g, (_, c) => `<pre><code>${c.trim()}</code></pre>`)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>');

export function writeReport({ outDir, meta, issues, steps, pages, testsFile }) {
  fs.mkdirSync(outDir, { recursive: true });
  const counts = { high: 0, medium: 0, low: 0 };
  for (const i of issues) counts[i.severity] += 1;

  const json = { tool: 'jaanch', version: meta.version, ...meta, counts, issues, steps, pages, testsFile };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(json, null, 2));

  const bugCard = (i) => `
  <article class="bug sev-${i.severity}" id="${i.id}">
    <header>
      <span class="badge ${i.severity}">${i.severity}</span>
      <h3>${esc(i.title)}</h3>
      <span class="kind">${esc(i.kind)}${i.occurrences > 1 ? ` · seen ${i.occurrences}×` : ''}</span>
    </header>
    <div class="grid">
      <div>
        <dl>
          <dt>What the user sees</dt><dd>${md(i.whatUserSees)}</dd>
          <dt>Likely cause</dt><dd>${md(i.likelyCause)}</dd>
          <dt>Suggested fix</dt><dd>${md(i.suggestedFix)}</dd>
        </dl>
        <details><summary>Steps to reproduce (${i.repro?.length ?? 0})</summary>
          <ol>${(i.repro ?? []).map((r) => `<li>${esc(r)}</li>`).join('')}</ol></details>
        <details><summary>Raw error</summary>
          <pre><code>${esc(i.message)}${i.stack ? '\n\n' + esc(i.stack) : ''}</code></pre>
          ${i.snippet ? `<p class="muted">Source: ${esc(shortUrl(i.source.url))}:${i.source.line}</p><pre><code>${esc(i.snippet)}</code></pre>` : ''}
        </details>
        <p class="muted small">Page: ${esc(shortUrl(i.pageUrl))} · step ${i.step} · explained by ${i.by === 'ai' ? 'BharatCode AI' : 'built-in rules'}</p>
      </div>
      ${i.screenshot ? `<a href="${esc(i.screenshot)}" target="_blank"><img loading="lazy" src="${esc(i.screenshot)}" alt="Screenshot when ${esc(i.id)} happened"></a>` : '<div></div>'}
    </div>
  </article>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jaanch report · ${esc(new URL(meta.startUrl).host)}</title>
<style>
:root{--bg:#f7f6f2;--card:#fff;--ink:#1b1b1f;--muted:#6b6b76;--line:#e6e3dc;--high:#d1352b;--medium:#d98a00;--low:#4b6bdc;--accent:#ff6a13;--code:#f1efe9}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--card:#1b1b1f;--ink:#ecebe8;--muted:#9a99a3;--line:#2c2c33;--code:#25252b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1080px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:28px;margin:0 0 4px}h1 span{color:var(--accent)}h2{margin:40px 0 12px;font-size:19px}h3{margin:0;font-size:16px;flex:1}
.muted{color:var(--muted)}.small{font-size:13px}
.meta{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;color:var(--muted)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin:24px 0}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}.stat b{display:block;font-size:28px;line-height:1.1}
.stat.high b{color:var(--high)}.stat.medium b{color:var(--medium)}.stat.low b{color:var(--low)}
.bug{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--line);border-radius:12px;padding:16px 18px;margin:12px 0}
.bug.sev-high{border-left-color:var(--high)}.bug.sev-medium{border-left-color:var(--medium)}.bug.sev-low{border-left-color:var(--low)}
.bug header{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.badge{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:3px 8px;border-radius:99px;color:#fff}
.badge.high{background:var(--high)}.badge.medium{background:var(--medium)}.badge.low{background:var(--low)}
.kind{font-size:12px;color:var(--muted);font-family:ui-monospace,monospace}
.grid{display:grid;grid-template-columns:1fr 320px;gap:18px}@media (max-width:760px){.grid{grid-template-columns:1fr}}
.grid img{width:100%;border:1px solid var(--line);border-radius:8px}
dl{margin:0}dt{font-weight:600;font-size:13px;color:var(--muted);margin-top:8px}dd{margin:2px 0 0}
pre{background:var(--code);padding:10px 12px;border-radius:8px;overflow-x:auto;font-size:12.5px}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em}
:not(pre)>code{background:var(--code);padding:1px 5px;border-radius:4px}
details{margin-top:8px}summary{cursor:pointer;font-size:13px;color:var(--muted)}
.steps{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:6px 0;list-style:none;margin:0}
.steps li{padding:7px 16px;border-top:1px solid var(--line);display:flex;gap:10px;font-size:14px}.steps li:first-child{border-top:0}
.steps .n{color:var(--muted);font-variant-numeric:tabular-nums;width:28px;flex:none}.steps .why{color:var(--muted);font-size:13px}
.steps .hit{color:var(--high);font-weight:600}.by{font-size:11px;border:1px solid var(--line);border-radius:4px;padding:0 5px;color:var(--muted)}
.pages{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.pages figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}.pages img{width:100%;display:block}
.pages figcaption{padding:8px 10px;font-size:13px}
.empty{background:var(--card);border:1px dashed var(--line);border-radius:12px;padding:28px;text-align:center}
footer{margin-top:48px;font-size:13px;color:var(--muted)}a{color:var(--accent)}
</style></head><body><main>
<h1><span>Jaanch</span> report</h1>
<div class="meta">
  <span>🌐 ${esc(meta.startUrl)}</span><span>🕒 ${esc(new Date(meta.startedAt).toLocaleString('en-IN'))}</span>
  <span>🦁 ${esc(meta.browser)}</span><span>🧠 ${meta.ai ? `BharatCode AI (${esc(meta.model)})` : 'Rules only (no AI key)'}</span>
  <span>⏱ ${(meta.durationMs / 1000).toFixed(1)}s</span>
</div>
<section class="stats">
  <div class="stat high"><b>${counts.high}</b>high</div>
  <div class="stat medium"><b>${counts.medium}</b>medium</div>
  <div class="stat low"><b>${counts.low}</b>low</div>
  <div class="stat"><b>${pages.length}</b>pages visited</div>
  <div class="stat"><b>${steps.length - 1}</b>actions tried</div>
</section>
${testsFile ? `<p>🧪 Wrote regression tests to <code>${esc(testsFile)}</code>. Run them with <code>npx playwright test ${esc(testsFile)}</code>. They fail until the bugs are fixed.</p>` : ''}

<h2>Bugs found (${issues.length})</h2>
${issues.length ? issues.map(bugCard).join('\n') : '<div class="empty">No bugs found in this run. 🎉 Try more steps with <code>--steps 60</code>.</div>'}

<h2>Journey</h2>
<ol class="steps">
${steps
  .map(
    (s) => `<li><span class="n">${s.n}</span><div><div>${esc(s.description)} ${s.by && s.by !== 'start' ? `<span class="by">${s.by === 'ai' ? 'AI' : 'rules'}</span>` : ''} ${s.newIssues ? `<span class="hit">→ ${s.newIssues} issue${s.newIssues > 1 ? 's' : ''}</span>` : ''}</div>${s.reason ? `<div class="why">${esc(s.reason)}</div>` : ''}${s.error ? `<div class="why">⚠ ${esc(s.error)}</div>` : ''}</div></li>`
  )
  .join('\n')}
</ol>

<h2>Pages visited</h2>
<div class="pages">
${pages.map((p) => `<figure><a href="${esc(p.screenshot)}" target="_blank"><img loading="lazy" src="${esc(p.screenshot)}" alt="${esc(p.title)}"></a><figcaption><b>${esc(p.title || '(untitled)')}</b><br><span class="muted">${esc(shortUrl(p.url))}</span></figcaption></figure>`).join('\n')}
</div>
<footer>Generated by <a href="https://github.com/Ajay702/jaanch">Jaanch</a> ${esc(meta.version)} · Playwright + ${esc(meta.browser)}${meta.ai ? ` + BharatCode AI · ${meta.aiUsage.calls} model calls` : ''}</footer>
</main></body></html>`;
  const file = path.join(outDir, 'report.html');
  fs.writeFileSync(file, html);
  return file;
}
