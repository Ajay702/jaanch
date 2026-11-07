// The exploration loop: look at the page, pick an action, do it, record what broke.
import fs from 'node:fs';
import path from 'node:path';
import { Collector, shortUrl } from './collector.js';
import { snapshot, describe, locatorFor } from './snapshot.js';
import { candidates, describeAction, elementKey } from './planner.js';

const normalize = (url) => {
  const u = new URL(url);
  return u.origin + u.pathname + u.search;
};

async function settle(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(400); // let async handlers throw
}

export async function explore({ browser, startUrl, maxSteps, planner, outDir, log, viewport = { width: 1280, height: 800 } }) {
  const origin = new URL(startUrl).origin;
  const context = await browser.newContext({ viewport, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  context.on('page', (p) => {
    // Links with target=_blank open a new tab; keep everything in one tab.
    if (p !== page) p.close().catch(() => {});
  });
  const collector = new Collector(origin);
  collector.attach(page);

  const shotsDir = path.join(outDir, 'screens');
  fs.mkdirSync(shotsDir, { recursive: true });

  const mem = { startUrl, visited: new Set(), frontier: [], tried: new Set(), history: [], issueCount: 0 };
  const pages = new Map(); // normalized url -> { url, title, findings, screenshot }
  const steps = [];

  const visitPage = async (snap, stepNo) => {
    const key = normalize(snap.url);
    for (const el of snap.elements) {
      if (el.tag === 'a' && el.href) {
        try {
          const u = new URL(el.href);
          const t = normalize(el.href);
          if (u.origin === origin && !mem.frontier.includes(t)) mem.frontier.push(t);
        } catch {}
      }
    }
    if (pages.has(key)) return;
    mem.visited.add(key);
    const shot = `page-${pages.size + 1}.png`;
    await page.screenshot({ path: path.join(shotsDir, shot), fullPage: false }).catch(() => {});
    pages.set(key, { url: snap.url, title: snap.title, findings: snap.findings, screenshot: `screens/${shot}`, firstStep: stepNo });
    log.page(shortUrl(snap.url), snap.title, snap.findings.length);
  };

  // Step 0: open the start URL.
  collector.currentStep = 0;
  collector.currentUrl = startUrl;
  const t0 = Date.now();
  const resp = await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((err) => {
    throw new Error(`Could not open ${startUrl}: ${err.message.split('\n')[0]}. Is your app running?`);
  });
  await settle(page);
  steps.push({ n: 0, type: 'goto', url: startUrl, description: `open ${shortUrl(startUrl)}`, locator: null, status: resp?.status(), ms: Date.now() - t0, by: 'start' });

  for (let n = 1; n <= maxSteps; n++) {
    let snap;
    try {
      snap = await snapshot(page);
    } catch (err) {
      log.warn(`could not read page (${err.message.split('\n')[0]}); going back to start`);
      await page.goto(startUrl).catch(() => {});
      await settle(page);
      continue;
    }
    await visitPage(snap, n - 1);
    await finishStep(steps[steps.length - 1], collector, page, shotsDir);

    // Wandered off-site (e.g. a redirect)? Go back home.
    if (new URL(snap.url).origin !== origin) {
      await page.goto(startUrl).catch(() => {});
      await settle(page);
      continue;
    }

    mem.issueCount = collector.issues.length;
    const action = await planner.next(snap, mem);
    if (!action) {
      log.info('Nothing left to try. Exploration finished.');
      break;
    }

    collector.currentStep = n;
    collector.currentUrl = snap.url;
    const step = {
      n,
      type: action.type,
      description: describeAction(action),
      reason: action.reason,
      by: action.by,
      fromUrl: snap.url,
      value: action.value,
      locator: action.el ? locatorFor(action.el) : null,
      target: action.el ? describe(action.el) : null,
      url: action.url,
    };
    if (action.el) mem.tried.add(elementKey(snap.url, action.el));

    const t = Date.now();
    try {
      const loc = action.el ? page.locator(`[data-jaanch-id="${action.el.id}"]`) : null;
      if (action.type === 'fill') await loc.fill(action.value ?? '', { timeout: 3000 });
      else if (action.type === 'select') await loc.selectOption({ index: 1 }, { timeout: 3000 }).catch(() => loc.selectOption({ index: 0 }));
      else if (action.type === 'click') await loc.click({ timeout: 4000 });
      else if (action.type === 'goto') await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await settle(page);
    } catch (err) {
      step.error = err.message.split('\n')[0];
      // An element that exists but can't be clicked is worth reporting.
      if (action.type === 'click' && /intercept|not visible|outside of the viewport/i.test(err.message)) {
        collector.add({ kind: 'unclickable', message: `${step.target} can't be clicked: ${step.error.slice(0, 160)}` });
      }
      await settle(page);
    }
    step.ms = Date.now() - t;
    step.toUrl = page.url();
    if (action.type === 'goto') mem.frontier = mem.frontier.filter((u) => u !== action.url);
    steps.push(step);
    mem.history.push(step);

    const fresh = collector.issuesForStep(n);
    step.newIssues = fresh.length;
    // If the action navigated, the bug belongs to the page that loaded, not the one we left.
    if (fresh.length && normalize(step.toUrl) !== normalize(step.fromUrl) && new URL(step.toUrl).origin === origin) {
      for (const i of fresh) Object.assign(i, { pageUrl: step.toUrl, linkedFrom: step.fromUrl, onLoad: true });
    }
    log.step(n, maxSteps, step, fresh);
  }

  // Final page snapshot so its checks and issues are counted too.
  try {
    const snap = await snapshot(page);
    await visitPage(snap, steps.length - 1);
  } catch {}
  await finishStep(steps[steps.length - 1], collector, page, shotsDir);

  // Page-level findings (accessibility) become low-severity issues, one per unique message.
  for (const p of pages.values()) {
    for (const f of p.findings) {
      collector.currentStep = p.firstStep;
      collector.currentUrl = p.url;
      collector.add({ kind: f.kind, message: f.message, screenshot: p.screenshot });
    }
  }

  await context.close();
  for (const s of steps) delete s.done;
  return { steps, issues: collector.issues, pages: [...pages.values()] };
}

/** Screenshot after a step that produced new issues, so each bug has a picture. */
async function finishStep(step, collector, page, shotsDir) {
  if (!step || step.done) return;
  step.done = true;
  const fresh = collector.issuesForStep(step.n);
  if (!fresh.length) return;
  const file = `step-${step.n}.png`;
  step.screenshot = `screens/${file}`;
  for (const i of fresh) i.screenshot ??= step.screenshot;
  await page.screenshot({ path: path.join(shotsDir, file) }).catch(() => {});
}

export { candidates };
