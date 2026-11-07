import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { launchBrowser } from './browser.js';
import { explore } from './explorer.js';
import { Planner } from './planner.js';
import { analyze } from './analyze.js';
import { generateTests } from './testgen.js';
import { writeReport } from './report.js';
import { aiAvailable, aiConfig, pingAI, usage } from './ai.js';

const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const HELP = `
jaanch — an AI tester that uses your web app like a real person and reports what breaks.

Usage
  jaanch <url> [options]

Options
  -s, --steps <n>        Max actions to try (default 25)
  -w, --watch            Show the browser while it works (headed, slowed down)
  -o, --out <dir>        Report folder (default ./jaanch-report)
  -t, --tests <file>     Where to write Playwright tests (default <out>/jaanch.spec.js)
  -b, --browser <name>   brave | chrome | edge (default brave, falls back to the others)
      --no-ai            Don't call the model; use built-in rules only
      --fail-on <level>  Exit 1 if a bug of this severity or worse is found: high | medium | low
      --open             Open the HTML report when done
      --check-ai         Test your BharatCode API key and exit
  -h, --help             Show this help
  -v, --version          Show version

AI
  Set BHARATCODE_API_KEY (from https://bharatcode.ai/account) in your shell or a .env file.
  Optional: JAANCH_MODEL (default qwen-3.8-27b), BHARATCODE_BASE_URL.

Examples
  jaanch http://localhost:3000
  jaanch http://localhost:5173 --watch --steps 40
  jaanch https://staging.example.com --fail-on high     # in CI
`;

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim = c(2), bold = c(1), red = c(31), yellow = c(33), blue = c(34), green = c(32), orange = c('38;5;208');

const SEV_ICON = { high: red('●'), medium: yellow('●'), low: blue('●') };

export const log = {
  info: (m) => console.log(`${dim('·')} ${m}`),
  warn: (m) => console.log(`${yellow('!')} ${m}`),
  page: (url, title, findings) => console.log(`${green('◆')} ${bold(url)} ${dim(title ? `“${title}”` : '')}${findings ? dim(` · ${findings} a11y finding(s)`) : ''}`),
  step: (n, max, step, fresh) => {
    const who = step.by === 'ai' ? orange('AI') : dim('rules');
    console.log(`  ${dim(String(n).padStart(2) + '/' + max)} ${who} ${step.description}${step.error ? dim(`  (${step.error.slice(0, 70)})`) : ''}`);
    for (const i of fresh) console.log(`       ${red('✖')} ${i.message.split('\n')[0].slice(0, 110)}`);
  },
};

function loadDotEnv() {
  const file = path.resolve('.env');
  if (fs.existsSync(file) && typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(file);
    } catch {}
  }
}

function openFile(file) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', file] : [file];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}

export async function main(argv = process.argv.slice(2)) {
  loadDotEnv();
  let opts;
  try {
    opts = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        steps: { type: 'string', short: 's', default: '25' },
        watch: { type: 'boolean', short: 'w', default: false },
        out: { type: 'string', short: 'o', default: 'jaanch-report' },
        tests: { type: 'string', short: 't' },
        browser: { type: 'string', short: 'b', default: 'brave' },
        'no-ai': { type: 'boolean', default: false },
        'fail-on': { type: 'string' },
        open: { type: 'boolean', default: false },
        'check-ai': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (err) {
    console.error(`${red('Error:')} ${err.message}\n${HELP}`);
    return 2;
  }
  const { values: o, positionals } = opts;
  if (o.help) return console.log(HELP), 0;
  if (o.version) return console.log(VERSION), 0;

  if (o['check-ai']) {
    if (!aiAvailable()) {
      console.error(`${red('✖')} BHARATCODE_API_KEY is not set. Get a key at https://bharatcode.ai/account and put it in .env`);
      return 1;
    }
    try {
      const r = await pingAI();
      console.log(`${green('✔')} BharatCode AI works (${aiConfig().model}): ${r.hello}`);
      return 0;
    } catch (err) {
      console.error(`${red('✖')} BharatCode AI call failed: ${err.message}`);
      return 1;
    }
  }

  let startUrl = positionals[0];
  if (!startUrl) {
    console.error(`${red('Error:')} give me a URL to test.\n${HELP}`);
    return 2;
  }
  if (!/^https?:\/\//.test(startUrl)) startUrl = `http://${startUrl}`;
  try {
    new URL(startUrl);
  } catch {
    console.error(`${red('Error:')} "${startUrl}" is not a valid URL`);
    return 2;
  }
  const maxSteps = Math.max(1, Math.min(200, parseInt(o.steps, 10) || 25));
  const failOn = o['fail-on'];
  if (failOn && !['high', 'medium', 'low'].includes(failOn)) {
    console.error(`${red('Error:')} --fail-on must be high, medium or low`);
    return 2;
  }
  const useAI = !o['no-ai'] && aiAvailable();
  const outDir = path.resolve(o.out);
  fs.rmSync(path.join(outDir, 'screens'), { recursive: true, force: true });

  console.log(`\n${orange(bold('Jaanch'))} ${dim('v' + VERSION)}  ${dim('— testing')} ${bold(startUrl)}`);
  console.log(dim(`  brain: ${useAI ? `BharatCode AI (${aiConfig().model})` : 'built-in rules' + (o['no-ai'] ? '' : ' — set BHARATCODE_API_KEY for AI mode')} · up to ${maxSteps} actions\n`));

  const startedAt = Date.now();
  const { browser, info } = await launchBrowser({ preferred: o.browser, headless: !o.watch, slowMo: o.watch ? 250 : 0 });
  log.info(`Browser: ${info.label}${o.watch ? ' (watch mode)' : ' (headless)'}`);

  let result;
  try {
    result = await explore({ browser, startUrl, maxSteps, planner: new Planner({ useAI, log }), outDir, log });
  } finally {
    await browser.close().catch(() => {});
  }

  const issues = await analyze({ issues: result.issues, steps: result.steps, origin: new URL(startUrl).origin, useAI, log });

  let testsFile = null;
  const spec = generateTests({ issues, steps: result.steps, startUrl });
  if (spec) {
    const target = path.resolve(o.tests ?? path.join(outDir, 'jaanch.spec.js'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, spec);
    testsFile = path.relative(process.cwd(), target) || target;
  }

  const meta = {
    version: VERSION,
    startUrl,
    startedAt,
    durationMs: Date.now() - startedAt,
    browser: info.label,
    ai: useAI,
    model: useAI ? aiConfig().model : null,
    aiUsage: { ...usage },
  };
  const reportFile = writeReport({ outDir, meta, issues, steps: result.steps, pages: result.pages, testsFile });

  // Summary
  const counts = { high: 0, medium: 0, low: 0 };
  for (const i of issues) counts[i.severity] += 1;
  console.log(`\n${bold('Found')} ${red(counts.high + ' high')}, ${yellow(counts.medium + ' medium')}, ${blue(counts.low + ' low')} ${dim(`across ${result.pages.length} pages in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)}`);
  for (const i of issues.filter((x) => x.severity !== 'low').slice(0, 8)) {
    console.log(`  ${SEV_ICON[i.severity]} ${i.title}`);
  }
  if (counts.low) console.log(dim(`  …plus ${counts.low} low-severity (accessibility) finding(s)`));
  console.log(`\n  📄 Report: ${bold(path.relative(process.cwd(), reportFile))}`);
  if (testsFile) console.log(`  🧪 Tests:  ${bold(testsFile)} ${dim('(npx playwright test ' + testsFile + ')')}`);
  if (useAI) console.log(dim(`  🧠 ${usage.calls} BharatCode calls · ${usage.inputTokens + usage.outputTokens} tokens`));
  console.log('');
  if (o.open) openFile(reportFile);

  if (failOn) {
    const order = ['high', 'medium', 'low'];
    const limit = order.indexOf(failOn);
    if (issues.some((i) => order.indexOf(i.severity) <= limit)) return 1;
  }
  return 0;
}
