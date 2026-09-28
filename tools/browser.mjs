// Shared headless-Chrome launcher. Every puppeteer script in this tree launches through here so a
// dead or killed script can never leave a SwiftShader Chrome burning CPU (three orphans once ran
// for 3 h at ~4 cores each). Three layers, because no single one covers every way node dies:
//   1. exit / SIGINT / SIGTERM / SIGHUP / uncaught error -> SIGKILL Chrome's whole process group.
//   2. A detached sh watchdog polls node's pid; if node is SIGKILLed (agent tool timeout, OOM) and
//      Chrome is still up, it kills the group and deletes the temp profile. It exits by itself
//      once either process is gone, so a normal run leaves nothing behind.
//   3. A hard lifetime cap (maxMin, default 20, env BROWSER_MAX_MIN) for a hung page.
// usage: import { launchBrowser, CHROME } from './browser.mjs';   (path relative to the caller)
//        const browser = await launchBrowser({ args: [...], maxMin: 30 });   // rest -> puppeteer.launch
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

export const CHROME = ['/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
export const SWIFTSHADER_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'];

const WATCHDOG = `
while kill -0 "$1" 2>/dev/null && kill -0 "$2" 2>/dev/null; do sleep 1; done
if kill -0 "$2" 2>/dev/null; then kill -9 -"$2" 2>/dev/null || kill -9 "$2" 2>/dev/null; fi
case "$3" in /tmp/puppeteer_dev_chrome_profile-*) sleep 1; rm -rf "$3" ;; esac
`;

const live = new Set();
let hooked = false;
function killAll() {
  for (const pid of live) { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } }
  live.clear();
}
function hookProcess() {
  if (hooked) return; hooked = true;
  process.on('exit', killAll);
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) process.on(sig, () => { killAll(); process.exit(code); });
  // A throw after launch would otherwise skip the caller's close(); print it like node does, then exit.
  process.on('uncaughtException', (e) => { console.error(e); killAll(); process.exit(1); });
  process.on('unhandledRejection', (e) => { console.error(e); killAll(); process.exit(1); });
}

export async function launchBrowser({ maxMin = +(process.env.BROWSER_MAX_MIN || 20), ...opts } = {}) {
  hookProcess();
  // detached (puppeteer's Linux default, forced here) puts Chrome in its own process group, so one
  // kill of -pid also takes the gpu/renderer/utility children.
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, ...opts, detached: true });
  const proc = browser.process();
  if (!proc?.pid) return browser;
  const pid = proc.pid; live.add(pid);
  proc.once('exit', () => live.delete(pid));
  const profile = (proc.spawnargs.find((a) => a.startsWith('--user-data-dir=')) || '').slice('--user-data-dir='.length);
  spawn('sh', ['-c', WATCHDOG, 'browser-watchdog', String(process.pid), String(pid), profile], { detached: true, stdio: 'ignore' }).unref();
  if (maxMin > 0) {
    // Per browser, not per process: cleared when this browser closes, so a script that launches several in
    // sequence is not killed maxMin after its FIRST launch.
    const cap = setTimeout(() => { console.error(`browser.mjs: headless Chrome exceeded ${maxMin} min, killing it (BROWSER_MAX_MIN to raise)`); killAll(); process.exit(124); }, maxMin * 60000);
    cap.unref(); browser.once('disconnected', () => clearTimeout(cap));
  }
  return browser;
}
