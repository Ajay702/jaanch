// On-page heads-up display for --watch and --record: shows what Jaanch is doing and the bugs
// it has found, and highlights the element it is about to use. It ignores the mouse and is
// built from plain <div>s, so it never affects exploration or the accessibility checks.

const INIT = `(() => {
  if (window.__jaanchHud) return;
  const css = \`
  #__jaanch_hud{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:360px;pointer-events:none;
    font:13px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#f4f2ee;
    background:rgba(20,20,24,.92);border:1px solid rgba(255,255,255,.12);border-radius:14px;
    box-shadow:0 12px 40px rgba(0,0,0,.35);padding:12px 14px;backdrop-filter:blur(6px)}
  #__jaanch_hud .t{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px}
  #__jaanch_hud .t i{font-style:normal;color:#ff7a1a}
  #__jaanch_hud .t s{text-decoration:none;margin-left:auto;font-weight:500;font-size:11px;color:#b9b6b0;
    border:1px solid rgba(255,255,255,.18);border-radius:99px;padding:1px 8px}
  #__jaanch_hud .a{margin-top:8px;padding:8px 10px;border-radius:9px;background:rgba(255,255,255,.07)}
  #__jaanch_hud .a.think{color:#ffcf99}
  #__jaanch_hud .a b{color:#fff}
  #__jaanch_hud .why{margin-top:4px;color:#b9b6b0;font-size:12px}
  #__jaanch_hud .bugs{margin-top:8px;display:grid;gap:4px}
  #__jaanch_hud .bug{color:#ff8f87;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #__jaanch_hud .bug.new{animation:__jflash 1.2s ease-out}
  #__jaanch_hud .n{margin-top:8px;font-size:12px;color:#b9b6b0}
  #__jaanch_hud .n b{color:#ff6b61;font-size:15px}
  @keyframes __jflash{0%{background:rgba(255,80,70,.45)}100%{background:transparent}}
  .__jaanch_target{outline:3px solid #ff7a1a!important;outline-offset:3px!important;
    box-shadow:0 0 0 8px rgba(255,122,26,.25)!important;transition:outline .15s}\`;
  const mount = () => {
    if (document.getElementById('__jaanch_hud') || !document.body) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const d = document.createElement('div'); d.id = '__jaanch_hud'; d.setAttribute('aria-hidden', 'true');
    document.body.appendChild(d);
    if (window.__jaanchState) window.__jaanchHud(window.__jaanchState);
  };
  const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]);
  window.__jaanchHud = (s) => {
    window.__jaanchState = s;
    const d = document.getElementById('__jaanch_hud'); if (!d) return;
    const bugs = (s.bugs || []).slice(-4).map((b, i, a) =>
      '<div class="bug' + (s.fresh && i >= a.length - s.fresh ? ' new' : '') + '">✖ ' + esc(b) + '</div>').join('');
    d.innerHTML = '<div class="t">🔍 <span><i>Jaanch</i> AI tester</span><s>' + esc(s.brain) + '</s></div>' +
      '<div class="a' + (s.thinking ? ' think' : '') + '">' + (s.thinking ? '🧠 ' : '👉 ') + '<b>' + esc(s.action) + '</b>' +
      (s.why ? '<div class="why">' + esc(s.why) + '</div>' : '') + '</div>' +
      (bugs ? '<div class="bugs">' + bugs + '</div>' : '') +
      '<div class="n">Step ' + s.step + ' · bugs found: <b>' + (s.bugs || []).length + '</b></div>';
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();`;

export class Hud {
  constructor(page, { brain }) {
    this.page = page;
    this.state = { brain, step: 0, action: 'Opening the app…', why: '', thinking: false, bugs: [], fresh: 0 };
  }

  async install(context) {
    await context.addInitScript(INIT);
  }

  async show(patch = {}) {
    Object.assign(this.state, patch);
    await this.page
      .evaluate(([init, s]) => {
        if (!window.__jaanchHud) (0, eval)(init);
        window.__jaanchHud(s);
      }, [INIT, this.state])
      .catch(() => {});
  }

  async highlight(jaanchId, ms = 700) {
    await this.page
      .evaluate((id) => {
        document.querySelectorAll('.__jaanch_target').forEach((e) => e.classList.remove('__jaanch_target'));
        const el = document.querySelector(`[data-jaanch-id="${id}"]`);
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          el.classList.add('__jaanch_target');
        }
      }, jaanchId)
      .catch(() => {});
    await this.page.waitForTimeout(ms);
  }

  async clearHighlight() {
    await this.page.evaluate(() => document.querySelectorAll('.__jaanch_target').forEach((e) => e.classList.remove('__jaanch_target'))).catch(() => {});
  }

  async bugs(newIssues) {
    if (!newIssues.length) return this.show({ fresh: 0 });
    const msgs = newIssues.map((i) => i.message.split('\n')[0].slice(0, 90));
    await this.show({ bugs: [...this.state.bugs, ...msgs], fresh: msgs.length });
  }
}
