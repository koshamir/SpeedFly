// Browser for the playwright tools (shot, perf, zip check).
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';

// Bundled chromium of this playwright version, else any cached ms-playwright chromium (newest first),
// else installed Chrome (may be blocked by policy for headless).
export async function launch(): Promise<Browser> {
  const args = ['--ignore-gpu-blocklist'];
  if (existsSync(chromium.executablePath())) return chromium.launch({ args });
  const cache = join(process.env.LOCALAPPDATA ?? join(homedir(), '.cache'), 'ms-playwright');
  const builds = existsSync(cache)
    ? readdirSync(cache)
        .filter((d) => /^chromium-\d+$/.test(d))
        .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    : [];
  for (const d of builds) {
    const exe = ['chrome-win64/chrome.exe', 'chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']
      .map((p) => join(cache, d, p))
      .find((p) => existsSync(p));
    if (exe) return chromium.launch({ executablePath: exe, args });
  }
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ channel, args });
    } catch {
      // try next
    }
  }
  throw new Error('No browser for playwright: run `npx playwright install chromium`');
}

