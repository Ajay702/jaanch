// Finds a Chromium-based browser on this machine (Brave first) and launches it with Playwright.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const env = process.env;
const win = (...parts) => parts.filter(Boolean).length === parts.length ? path.win32.join(...parts) : null;

const CANDIDATES = {
  brave: {
    darwin: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
    linux: ['/usr/bin/brave-browser', '/usr/bin/brave', '/snap/bin/brave', '/opt/brave.com/brave/brave'],
    win32: [
      win(env.PROGRAMFILES, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      win(env.LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ],
  },
  chrome: {
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
    win32: [
      win(env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      win(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ],
  },
  edge: {
    darwin: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    linux: ['/usr/bin/microsoft-edge'],
    win32: [win(env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')],
  },
};

const LABEL = { brave: 'Brave', chrome: 'Google Chrome', edge: 'Microsoft Edge' };

/** Returns { name, executablePath } for the preferred browser, falling back to the others. */
export function findBrowser(preferred = 'brave') {
  if (env.JAANCH_BROWSER_PATH && fs.existsSync(env.JAANCH_BROWSER_PATH)) {
    return { name: 'custom', label: path.basename(env.JAANCH_BROWSER_PATH), executablePath: env.JAANCH_BROWSER_PATH };
  }
  const order = [preferred, ...Object.keys(CANDIDATES).filter((k) => k !== preferred)];
  for (const name of order) {
    for (const p of CANDIDATES[name]?.[process.platform] ?? []) {
      if (p && fs.existsSync(p)) return { name, label: LABEL[name], executablePath: p };
    }
  }
  return null;
}

export async function launchBrowser({ preferred = 'brave', headless = true, slowMo = 0 } = {}) {
  const found = findBrowser(preferred);
  if (!found) {
    throw new Error(
      'No Brave, Chrome or Edge browser found. Install Brave (https://brave.com) ' +
        'or set JAANCH_BROWSER_PATH to a Chromium-based browser executable.'
    );
  }
  const browser = await chromium.launch({
    executablePath: found.executablePath,
    headless,
    slowMo,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-features=BraveRewards'],
  });
  return { browser, info: found };
}
