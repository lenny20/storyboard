import { spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const APP_URL = 'http://127.0.0.1:4317/';
const projectDirectory = fileURLToPath(new URL('../', import.meta.url));

export async function inspectServer(fetcher = fetch) {
  try {
    const response = await fetcher(`${APP_URL}storyboard-health.json`, {
      signal: AbortSignal.timeout(1500), cache: 'no-store',
    });
    if (!response.ok) return 'other';
    try {
      const body = await response.json();
      return body.app === 'storyboard-studio' && body.version === 1 ? 'storyboard' : 'other';
    } catch { return 'other'; }
  } catch { return 'offline'; }
}

async function modifiedAt(filename) {
  try { return (await stat(filename)).mtimeMs; }
  catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
}

async function newestWithin(directory) {
  let newest = await modifiedAt(directory);
  if (!newest) return 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const filename = path.join(directory, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? await newestWithin(filename) : await modifiedAt(filename));
  }
  return newest;
}

export async function needsBuild(directory = projectDirectory) {
  const builtAt = await modifiedAt(path.join(directory, 'dist/server/index.js'));
  if (!builtAt ||
      !await modifiedAt(path.join(directory, 'dist/client/storyboard-health.json'))) return true;
  const sources = ['app', 'components', 'lib', 'public', 'hooks', 'scripts'];
  for (const source of sources) if (await newestWithin(path.join(directory, source)) > builtAt) return true;
  for (const filename of ['package.json', 'package-lock.json', 'vite.config.ts', 'next.config.ts', 'tsconfig.json']) {
    if (await modifiedAt(path.join(directory, filename)) > builtAt) return true;
  }
  return false;
}

function run(command, args) {
  const child = spawn(command, args, { cwd: projectDirectory, stdio: 'inherit' });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with code ${code}.`)));
  });
}

function openBrowser() {
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  const opener = spawn(command, [APP_URL], { stdio: 'ignore' });
  opener.on('error', () => console.log(`Open ${APP_URL} in your usual browser.`));
  opener.unref();
}

export async function waitUntilReady({ probe = inspectServer, isRunning, timeoutMs = 30_000, intervalMs = 250 }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isRunning()) throw new Error('Storyboard Studio stopped before it was ready. See the startup error above.');
    const status = await probe();
    if (status === 'storyboard') return;
    if (status === 'other') throw new Error('Another application is using port 4317. Close it, then launch Storyboard Studio again.');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Storyboard Studio did not become ready within 30 seconds. See the startup output above.');
}

export async function launch({ open = true } = {}) {
  const existing = await inspectServer();
  if (existing === 'other') throw new Error('Port 4317 is occupied by another app or an older Storyboard server. Stop that server before starting this version.');
  if (existing === 'storyboard') {
    if (await needsBuild()) console.log('App files have changed. Stop the existing Storyboard terminal and launch again to load the update.');
    console.log(`Storyboard Studio is already running at ${APP_URL}`);
    if (open) openBrowser();
    return;
  }
  if (!await modifiedAt(path.join(projectDirectory, 'node_modules/vinext/package.json'))) await run('npm', ['ci']);
  if (await needsBuild()) await run('npm', ['run', 'build']);
  const child = spawn(process.execPath, ['node_modules/vinext/dist/cli.js', 'start', '--hostname', '127.0.0.1', '--port', '4317'], {
    cwd: projectDirectory, stdio: 'inherit',
  });
  let running = true;
  let spawnError;
  const completion = new Promise((resolve) => {
    child.once('error', (error) => { running = false; spawnError = error; resolve(1); });
    child.once('exit', (code) => { running = false; resolve(code ?? 0); });
  });
  const stop = () => { if (running) child.kill('SIGTERM'); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await waitUntilReady({ isRunning: () => running });
    console.log(`Storyboard Studio is ready at ${APP_URL}`);
    console.log('Keep this terminal open while working. Use the same browser profile for your saved projects.');
    if (open) openBrowser();
    const exitCode = await completion;
    if (spawnError) throw spawnError;
    process.exitCode = exitCode;
  } finally {
    stop();
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  launch({ open: !process.argv.includes('--no-open') }).catch((error) => { console.error(`\n${error.message}`); process.exitCode = 1; });
}
