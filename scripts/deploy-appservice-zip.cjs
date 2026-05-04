const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const deployDir = path.join(projectRoot, '.deploy');
const settingsPath = path.join(deployDir, 'appsettings.private.json');

const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID || '260948a4-1d5e-42c8-b095-33a6641ad189';
const resourceGroup = process.env.MORGAN_RESOURCE_GROUP || 'rg-morgan-finance-agent';
const webAppName = process.env.MORGAN_WEBAPP_NAME || 'morganfinanceagent-webapp';
const morganAiAccount = process.env.MORGAN_AI_ACCOUNT || 'ai-morgan-voicelive';
const speechResourceGroup = process.env.SPEECH_RESOURCE_GROUP || 'rg-avatar-foundry';
const speechAccount = process.env.SPEECH_ACCOUNT_NAME || 'speech-avatar-foundry';

const args = new Set(process.argv.slice(2));
const skipDeploy = args.has('--settings-only');
const skipSettings = args.has('--skip-settings');
const liveAvatarSettings = args.has('--live-avatar-settings');
const skipRoles = args.has('--skip-roles');
const skipAuth = args.has('--skip-auth');

function run(command, commandArgs, options = {}) {
  try {
    return execFileSync(command, commandArgs, {
      cwd: options.cwd || projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: options.shell ?? process.platform === 'win32',
      timeout: options.timeoutMs || 180_000,
      windowsHide: true,
    }).trim();
  } catch (error) {
    if (!options.allowFailure) {
      const stderr = Buffer.isBuffer(error.stderr) ? error.stderr.toString('utf8').trim() : '';
      throw new Error(`${command} ${commandArgs.slice(0, 3).join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
    }
    return '';
  }
}

function copyRuntimeItem(sourceRel, targetRoot) {
  const source = path.join(projectRoot, sourceRel);
  if (!fs.existsSync(source)) return false;
  const target = path.join(targetRoot, sourceRel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: true });
  return true;
}

function az(azArgs, options = {}) {
  return run('az', azArgs, options);
}

function parseJson(output, fallback = null) {
  if (!output) return fallback;
  return JSON.parse(output);
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2] || '';
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

function isPlaceholder(value) {
  return !value || /^<.*>$/.test(value) || /your-|example|\.\.\.|optional-/i.test(value);
}

function buildAppSettings() {
  const env = parseEnvFile(path.join(projectRoot, '.env'));
  const excluded = new Set(['PORT', 'HOST']);
  const settings = {
    SCM_DO_BUILD_DURING_DEPLOYMENT: 'false',
    ENABLE_ORYX_BUILD: 'false',
    WEBSITE_NODE_DEFAULT_VERSION: '~20',
    NODE_ENV: 'production',
  };

  for (const [key, value] of Object.entries(env)) {
    if (excluded.has(key) || isPlaceholder(value)) continue;
    settings[key] = value;
  }
  return settings;
}

function syncAppSettings() {
  fs.mkdirSync(deployDir, { recursive: true });
  const settings = buildAppSettings();
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  try {
    az([
      'webapp', 'config', 'appsettings', 'set',
      '--resource-group', resourceGroup,
      '--name', webAppName,
      '--settings', `@${settingsPath}`,
      '--output', 'none',
    ], { timeoutMs: 120_000 });
  } finally {
    try { fs.rmSync(settingsPath, { force: true }); } catch { /* ignore */ }
  }
  return Object.keys(settings).sort();
}

function syncLiveAvatarSettings() {
  const settings = {
    AVATAR_BACKGROUND_COLOR: '#FFFFFF',
    AVATAR_CHARACTER: 'meg',
    AVATAR_STYLE: 'business',
    AVATAR_DISPLAY_NAME: 'Aria as Morgan',
    AGENT_ROLE: 'Digital CFO',
    VOICE_ENABLED_DEFAULT: 'true',
    WEBSITE_NODE_DEFAULT_VERSION: '~20',
    SCM_DO_BUILD_DURING_DEPLOYMENT: 'false',
    ENABLE_ORYX_BUILD: 'false',
    NODE_ENV: 'production',
    AUTONOMOUS_WORKDAY_ENABLED: 'true',
    AUTONOMOUS_WORKDAY_TIME_ZONE: 'Australia/Sydney',
    AUTONOMOUS_WORKDAY_START_HOUR: '9',
    AUTONOMOUS_WORKDAY_END_HOUR: '17',
    AUTONOMOUS_WORKDAY_INTERVAL_MINUTES: '25',
  };
  az([
    'webapp', 'config', 'appsettings', 'set',
    '--resource-group', resourceGroup,
    '--name', webAppName,
    '--settings', ...Object.entries(settings).map(([key, value]) => `${key}=${value}`),
    '--output', 'none',
  ], { timeoutMs: 120_000 });
  return Object.keys(settings).sort();
}

function appSettingValues() {
  const rows = parseJson(az([
    'webapp', 'config', 'appsettings', 'list',
    '--resource-group', resourceGroup,
    '--name', webAppName,
    '--output', 'json',
  ], { timeoutMs: 120_000 }), []);
  const settings = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.name) settings[row.name] = row.value || '';
  }
  return settings;
}

function configureEasyAuth() {
  if (skipAuth) return 'skipped';
  const settings = appSettingValues();
  const clientId = settings.MicrosoftAppId;
  const tenantId = settings.MicrosoftAppTenantId;
  if (!clientId || !tenantId || !settings.MicrosoftAppPassword) return 'missing MicrosoftAppId, MicrosoftAppTenantId, or MicrosoftAppPassword app setting';
  const callbackUrl = `https://${webAppName}.azurewebsites.net/.auth/login/aad/callback`;
  const redirectUris = parseJson(az([
    'ad', 'app', 'show',
    '--id', clientId,
    '--query', 'web.redirectUris',
    '--output', 'json',
  ], { timeoutMs: 120_000 }), []);
  const nextRedirectUris = Array.from(new Set([...(Array.isArray(redirectUris) ? redirectUris : []), callbackUrl]));

  az([
    'ad', 'app', 'update',
    '--id', clientId,
    '--enable-id-token-issuance', 'true',
    '--web-redirect-uris', ...nextRedirectUris,
    '--output', 'none',
  ], { timeoutMs: 120_000 });

  az([
    'webapp', 'auth-classic', 'update',
    '--resource-group', resourceGroup,
    '--name', webAppName,
    '--enabled', 'true',
    '--action', 'AllowAnonymous',
    '--aad-client-id', clientId,
    '--aad-client-secret-setting-name', 'MicrosoftAppPassword',
    '--aad-token-issuer-url', `https://sts.windows.net/${tenantId}/`,
    '--output', 'none',
  ], { timeoutMs: 120_000 });

  return 'enabled in passive mode';
}

function assignManagedIdentityRoles() {
  if (skipRoles) return [];
  const webApp = parseJson(az([
    'webapp', 'show',
    '--resource-group', resourceGroup,
    '--name', webAppName,
    '--query', '{principalId:identity.principalId}',
    '--output', 'json',
  ]), {});
  const principalId = webApp?.principalId;
  if (!principalId) {
    throw new Error('Web App system-assigned identity is not enabled. Enable identity before deploying Morgan.');
  }

  const roleTargets = [];
  const morganAiScope = az([
    'cognitiveservices', 'account', 'show',
    '--resource-group', resourceGroup,
    '--name', morganAiAccount,
    '--query', 'id',
    '--output', 'tsv',
  ], { allowFailure: true });
  if (morganAiScope) {
    roleTargets.push([morganAiScope, 'Cognitive Services OpenAI User']);
    roleTargets.push([morganAiScope, 'Cognitive Services User']);
  }

  const speechScope = az([
    'cognitiveservices', 'account', 'show',
    '--resource-group', speechResourceGroup,
    '--name', speechAccount,
    '--query', 'id',
    '--output', 'tsv',
  ], { allowFailure: true });
  if (speechScope) roleTargets.push([speechScope, 'Cognitive Services User']);

  const assigned = [];
  for (const [scope, role] of roleTargets) {
    az([
      'role', 'assignment', 'create',
      '--assignee-object-id', principalId,
      '--assignee-principal-type', 'ServicePrincipal',
      '--role', role,
      '--scope', scope,
      '--output', 'none',
    ], { allowFailure: true, timeoutMs: 120_000 });
    assigned.push(role);
  }
  return assigned;
}

function createDeploymentZip() {
  fs.mkdirSync(deployDir, { recursive: true });
  const zipPath = path.join(deployDir, `morgan-d-cfo-${Date.now()}.zip`);
  const stageDir = path.join(deployDir, `runtime-${Date.now()}`);
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  for (const item of [
    'package.json',
    'package-lock.json',
    'dist',
    'manifest',
    'ToolingManifest.json',
    'scripts/start-production.cjs',
  ]) {
    copyRuntimeItem(item, stageDir);
  }

  const escapedRoot = stageDir.replace(/'/g, "''");
  const escapedZip = zipPath.replace(/'/g, "''");
  const zipFileScript = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $root='${escapedRoot}'; $zip='${escapedZip}'; if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }; $archive=[System.IO.Compression.ZipFile]::Open($zip, [System.IO.Compression.ZipArchiveMode]::Create); try { Get-ChildItem -LiteralPath $root -Recurse -File -Force | ForEach-Object { $relative=$_.FullName.Substring($root.Length).TrimStart('\\','/').Replace('\\','/'); [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $relative, [System.IO.Compression.CompressionLevel]::Fastest) | Out-Null } } finally { $archive.Dispose() }; Write-Output $zip`;
  const compressArchiveScript = `$ErrorActionPreference='Stop'; $root='${escapedRoot}'; $zip='${escapedZip}'; if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }; $items=Get-ChildItem -LiteralPath $root -Force; Compress-Archive -LiteralPath $items.FullName -DestinationPath $zip -Force; Write-Output $zip`;
  try {
    try {
      run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', zipFileScript], { shell: false, timeoutMs: 900_000 });
    } catch {
      run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', compressArchiveScript], { shell: false, timeoutMs: 900_000 });
    }
    return zipPath;
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

function deployZip(zipPath) {
  az([
    'webapp', 'deploy',
    '--resource-group', resourceGroup,
    '--name', webAppName,
    '--src-path', zipPath,
    '--type', 'zip',
    '--async', 'false',
  ], { timeoutMs: 900_000 });
  try {
    az(['webapp', 'config', 'set', '--resource-group', resourceGroup, '--name', webAppName, '--startup-file', 'npm start', '--output', 'none'], { timeoutMs: 120_000 });
  } catch (error) {
    console.warn(`[deploy] Startup file update skipped after successful zip deploy: ${error.message}`);
  }
  az(['webapp', 'restart', '--resource-group', resourceGroup, '--name', webAppName, '--output', 'none'], { timeoutMs: 120_000 });
}

az(['config', 'set', 'extension.use_dynamic_install=yes_without_prompt'], { allowFailure: true, timeoutMs: 30_000 });
az(['account', 'set', '--subscription', subscriptionId], { timeoutMs: 30_000 });

console.log(`[deploy] Target: ${webAppName} in ${resourceGroup}`);
if (skipSettings) {
  console.log('[deploy] Full app setting sync skipped.');
} else {
  const settingKeys = syncAppSettings();
  console.log(`[deploy] Synced ${settingKeys.length} app setting key(s): ${settingKeys.join(', ')}`);
}
if (liveAvatarSettings) {
  const settingKeys = syncLiveAvatarSettings();
  console.log(`[deploy] Synced live avatar runtime setting key(s): ${settingKeys.join(', ')}`);
}
const authStatus = configureEasyAuth();
console.log(`[deploy] Browser sign-in auth: ${authStatus}`);
const assignedRoles = assignManagedIdentityRoles();
console.log(`[deploy] Managed identity role assignment attempts: ${assignedRoles.join(', ') || '(skipped)'}`);

if (skipDeploy) {
  console.log('[deploy] Settings-only mode complete.');
  process.exit(0);
}

const zipPath = createDeploymentZip();
console.log(`[deploy] Created deployment package: ${path.relative(projectRoot, zipPath)}`);
deployZip(zipPath);
console.log(`[deploy] Deployment complete: https://${webAppName}.azurewebsites.net`);