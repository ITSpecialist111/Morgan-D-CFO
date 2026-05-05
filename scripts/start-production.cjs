const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const requiredModules = ['dotenv', 'express', 'openai', '@microsoft/agents-hosting'];
const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || '0.0.0.0';

function run(command, args) {
  const npmCache = process.env.NPM_CONFIG_CACHE || process.env.npm_config_cache || (process.platform === 'win32' ? path.join(root, '.npm-cache') : '/tmp/npm-cache');
  try { fs.mkdirSync(npmCache, { recursive: true }); } catch { /* ignore */ }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, NPM_CONFIG_CACHE: npmCache, npm_config_cache: npmCache },
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code || 1}`));
      }
    });
  });
}

function missingRuntimeDependencies() {
  if (!fs.existsSync(path.join(root, 'node_modules'))) return true;
  return requiredModules.some((moduleName) => {
    try {
      require.resolve(moduleName, { paths: [root] });
      return false;
    } catch {
      return true;
    }
  });
}

function createStartupServer() {
  let state = 'installing';
  let detail = 'Installing Morgan production dependencies.';
  const server = http.createServer((_req, res) => {
    const body = JSON.stringify({ status: state, detail, timestamp: new Date().toISOString() });
    res.writeHead(state === 'failed' ? 500 : 202, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  });
  server.listen(port, host, () => console.log(`[startup] Temporary health server listening on ${host}:${port}`));
  return {
    server,
    fail(error) {
      state = 'failed';
      detail = error instanceof Error ? error.message : String(error);
    },
    update(nextDetail) {
      detail = nextDetail;
    },
  };
}

function optimizedNodeModulesArchive() {
  const archivePath = path.join(root, 'node_modules.tar.gz');
  return fs.existsSync(archivePath) ? archivePath : null;
}

async function start() {
  if (missingRuntimeDependencies()) {
    const startupServer = createStartupServer();
    const archivePath = optimizedNodeModulesArchive();
    if (archivePath) {
      console.log(`[startup] Found optimized node_modules archive at ${archivePath}; extracting.`);
      startupServer.update('Extracting Morgan production dependencies from App Service optimized package.');
      try {
        await run('tar', ['-xzf', archivePath, '-C', root]);
      } catch (error) {
        startupServer.fail(error);
        console.error('[startup] Runtime dependency extraction failed:', error);
        return;
      }
      if (!missingRuntimeDependencies()) {
        console.log('[startup] Runtime dependencies extracted; starting Morgan.');
        startupServer.server.close(() => require(path.join(root, 'dist', 'index.js')));
        return;
      }
      console.warn('[startup] Optimized archive extracted, but required modules are still missing. Falling back to npm install.');
    }

    console.log('[startup] Runtime dependencies missing; installing production packages.');
    startupServer.update('Installing Morgan production dependencies.');
    try {
      await run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
    } catch (error) {
      startupServer.fail(error);
      console.error('[startup] Runtime dependency install failed:', error);
      return;
    }
    if (!missingRuntimeDependencies()) {
      console.log('[startup] Runtime dependencies installed; starting Morgan.');
      startupServer.server.close(() => require(path.join(root, 'dist', 'index.js')));
      return;
    }
    const error = new Error('Runtime dependency install completed, but required modules are still missing.');
    startupServer.fail(error);
    console.error('[startup] Runtime dependency install failed:', error);
    return;
  }

  require(path.join(root, 'dist', 'index.js'));
}

start().catch((error) => {
  console.error('[startup] Morgan startup failed:', error);
  process.exitCode = 1;
});