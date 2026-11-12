import { cpSync, existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
for (const key of ['LMDB_PREBUILD', 'NODE_PATH', 'NODE_OPTIONS', 'NEXT_TEST_NATIVE_DIR']) {
  delete env[key];
}

const built = spawnSync(process.execPath, ['node_modules/next/dist/bin/next', 'build'], {
  env,
  stdio: 'inherit',
});
if (built.status !== 0) process.exit(built.status ?? 1);

const runtime = realpathSync(mkdtempSync(join(tmpdir(), 'next-lmdb-standalone-')));
const artifact = join(runtime, 'app');
cpSync('.next/standalone', artifact, { recursive: true, verbatimSymlinks: true });

function inspectLinks(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const target = relative(artifact, realpathSync(file));
      if (target === '..' || target.startsWith('../') || isAbsolute(target)) {
        throw new Error(`Symlink escapes standalone: ${relative(artifact, file)}`);
      }
    } else if (entry.isDirectory()) {
      inspectLinks(file);
    }
  }
}

let server;
let serverLog = '';
try {
  inspectLinks(artifact);
  const externalDirectory = join(artifact, '.next/node_modules');
  const externalName = readdirSync(externalDirectory).find((name) => name.startsWith('lmdb-'));
  if (!externalName) throw new Error('LMDB external entry was not found');
  const lmdb = realpathSync(join(externalDirectory, externalName));
  const nativePackage = `@lmdb/lmdb-${process.platform}-${process.arch}`;
  const privateAlias = join(artifact, 'node_modules/.pnpm/node_modules', nativePackage);
  const ownerLink = join(dirname(lmdb), nativePackage);
  console.log('All standalone symlinks resolve inside the copied artifact.');
  console.log('Native package included:', existsSync(privateAlias));
  console.log('Native binary included:', existsSync(privateAlias) && readdirSync(privateAlias).some((name) => name.endsWith('.node')));
  console.log('LMDB dependency symlink included:', existsSync(ownerLink));
  try {
    createRequire(join(lmdb, 'package.json')).resolve(nativePackage);
    console.log('Native package resolves from LMDB: true');
  } catch (error) {
    console.log('Native package resolves from LMDB:', error.code);
  }

  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  server = spawn(process.execPath, ['server.js'], {
    cwd: artifact,
    env: { ...env, HOSTNAME: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (data) => { serverLog += data; });
  server.stderr.on('data', (data) => { serverLog += data; });

  let passed = true;
  for (const [route, expected] of [['/', 'LMDB ESM: true'], ['/cjs', 'LMDB CJS: true']]) {
    let response;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        response = await fetch(`http://127.0.0.1:${port}${route}`, { signal: AbortSignal.timeout(3000) });
        break;
      } catch (error) {
        if (server.exitCode !== null || attempt === 49) throw error;
        await delay(200);
      }
    }
    const body = (await response.text()).replace(/<!--.*?-->/g, '');
    const ok = response.status === 200 && body.includes(expected);
    console.log(`${route}: HTTP ${response.status}; LMDB read/write passed: ${ok}`);
    passed &&= ok;
  }
  console.log('Expected: both routes return HTTP 200 after an LMDB write/read.');
  process.exitCode = passed ? 0 : 1;
} finally {
  if (server && server.exitCode === null) {
    const closed = new Promise((resolve) => server.once('close', resolve));
    server.kill('SIGTERM');
    const timeout = setTimeout(() => server.kill('SIGKILL'), 5000);
    await closed;
    clearTimeout(timeout);
  }
  console.log(serverLog.replaceAll(artifact, '<standalone>').trim());
  rmSync(runtime, { recursive: true, force: true });
}
