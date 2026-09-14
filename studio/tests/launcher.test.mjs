import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, utimes, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectServer, needsBuild, waitUntilReady } from '../scripts/launch.mjs';

test('launcher distinguishes Storyboard from an unrelated service on its fixed port', async () => {
  assert.equal(await inspectServer(async () => Response.json({ app: 'storyboard-studio', version: 1 })), 'storyboard');
  assert.equal(await inspectServer(async () => new Response('<html>Another app</html>')), 'other');
  assert.equal(await inspectServer(async () => Response.json({ app: 'other' })), 'other');
  assert.equal(await inspectServer(async () => { throw new Error('Connection refused'); }), 'offline');
});

test('launcher waits for actual readiness and reports early exit or a conflicting service', async () => {
  const states = ['offline', 'offline', 'storyboard'];
  await waitUntilReady({ probe: async () => states.shift(), isRunning: () => true, intervalMs: 1 });
  assert.equal(states.length, 0);
  await assert.rejects(waitUntilReady({ isRunning: () => false }), /stopped before/);
  await assert.rejects(waitUntilReady({ probe: async () => 'other', isRunning: () => true }), /Another application/);
});

test('launcher rebuilds incomplete output and detects changed source files', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'storyboard-launch-'));
  try {
    assert.equal(await needsBuild(directory), true);
    await mkdir(path.join(directory, 'dist/server'), { recursive: true });
    await mkdir(path.join(directory, 'dist/client'), { recursive: true });
    await mkdir(path.join(directory, 'app'));
    await writeFile(path.join(directory, 'app/page.tsx'), 'original');
    await writeFile(path.join(directory, 'dist/server/index.js'), 'compiled');
    // Dynamic local API builds need no static-export index.html.
    await writeFile(path.join(directory, 'dist/client/storyboard-health.json'), '{}');
    const built = new Date(Date.now() + 1000);
    await utimes(path.join(directory, 'dist/server/index.js'), built, built);
    assert.equal(await needsBuild(directory), false);
    const changed = new Date(Date.now() + 2000);
    await utimes(path.join(directory, 'app/page.tsx'), changed, changed);
    assert.equal(await needsBuild(directory), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
