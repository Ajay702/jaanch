// Listens to the browser and turns errors into issues: JS exceptions, console errors,
// failed requests and HTTP errors. Each issue is tagged with the step that triggered it.

const IGNORED_FAILURES = /ERR_ABORTED|ERR_BLOCKED_BY_CLIENT|ERR_BLOCKED_BY_RESPONSE/;
// Chrome logs "Failed to load resource" for every 4xx/5xx; the response listener already reports those.
const NOISY_CONSOLE = /^Failed to load resource/;

/** Parses the first "url:line:col" frame out of a stack trace or console location. */
export function firstFrame(stack = '') {
  const m = String(stack).match(/(https?:\/\/[^\s)]+):(\d+):(\d+)/);
  return m ? { url: m[1], line: Number(m[2]), column: Number(m[3]) } : null;
}

export class Collector {
  constructor(origin) {
    this.origin = origin;
    this.issues = [];
    this.seen = new Map(); // dedupe key -> issue
    this.currentStep = 0;
    this.currentUrl = '';
  }

  attach(page) {
    page.on('pageerror', (err) => {
      this.add({
        kind: 'js-exception',
        message: `${err.name || 'Error'}: ${err.message}`,
        source: firstFrame(err.stack),
        stack: err.stack?.split('\n').slice(0, 6).join('\n'),
      });
    });
    page.on('console', (msg) => {
      if (msg.type() !== 'error' || NOISY_CONSOLE.test(msg.text())) return;
      const loc = msg.location();
      this.add({
        kind: 'console-error',
        message: msg.text().slice(0, 500),
        source: loc?.url ? { url: loc.url, line: (loc.lineNumber ?? 0) + 1, column: loc.columnNumber ?? 0 } : null,
      });
    });
    page.on('requestfailed', (req) => {
      const text = req.failure()?.errorText ?? 'failed';
      if (IGNORED_FAILURES.test(text) || !this.isOwn(req.url())) return;
      this.add({ kind: 'request-failed', message: `${req.method()} ${shortUrl(req.url())} failed: ${text}`, url: req.url(), method: req.method() });
    });
    page.on('response', (res) => {
      const status = res.status();
      if (status < 400 || !this.isOwn(res.url())) return;
      const req = res.request();
      const type = req.resourceType();
      const kind = type === 'document' ? 'broken-page' : type === 'image' ? 'broken-image' : 'http-error';
      this.add({
        kind,
        message: `${req.method()} ${shortUrl(res.url())} returned ${status}`,
        url: res.url(),
        method: req.method(),
        status,
        resourceType: type,
      });
    });
  }

  isOwn(url) {
    try {
      return new URL(url).origin === this.origin;
    } catch {
      return false;
    }
  }

  /** Adds an issue unless an identical one was already recorded. Returns the issue or null. */
  add(issue) {
    const key = `${issue.kind}|${issue.message}|${issue.url ?? ''}`;
    if (this.seen.has(key)) {
      this.seen.get(key).occurrences += 1;
      return null;
    }
    const full = { id: `B${this.issues.length + 1}`, step: this.currentStep, pageUrl: this.currentUrl, occurrences: 1, ...issue };
    this.seen.set(key, full);
    this.issues.push(full);
    return full;
  }

  issuesForStep(step) {
    return this.issues.filter((i) => i.step === step);
  }
}

export function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}
