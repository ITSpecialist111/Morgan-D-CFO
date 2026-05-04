const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const requiredModules = ['dotenv', 'express', 'openai', '@microsoft/agents-hosting'];
const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || '0.0.0.0';

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with code ${result.status || 1}`);
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
  };
}

if (missingRuntimeDependencies()) {
  const startupServer = createStartupServer();
  console.log('[startup] Runtime dependencies missing; installing production packages.');
  try {
    run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
  } catch (error) {
    startupServer.fail(error);
    console.error('[startup] Runtime dependency install failed:', error);
  }
  if (!missingRuntimeDependencies()) {
    console.log('[startup] Runtime dependencies installed; starting Morgan.');
    startupServer.server.close(() => require(path.join(root, 'dist', 'index.js')));
  }
} else {
  require(path.join(root, 'dist', 'index.js'));
}