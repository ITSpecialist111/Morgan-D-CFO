const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const targetPath = path.join(projectRoot, '.env');
const templatePath = path.join(projectRoot, '.env.template');

const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID || '260948a4-1d5e-42c8-b095-33a6641ad189';
const morganResourceGroup = process.env.MORGAN_RESOURCE_GROUP || 'rg-morgan-finance-agent';
const morganWebApp = process.env.MORGAN_WEBAPP_NAME || 'morganfinanceagent-webapp';
const morganAiAccount = process.env.MORGAN_AI_ACCOUNT || 'ai-morgan-voicelive';
const morganFoundryProject = process.env.MORGAN_FOUNDRY_PROJECT || 'ai-morgan-voicelive-project';
const acrResourceGroup = process.env.ACR_RESOURCE_GROUP || 'rg-agent365-bridge';
const acrName = process.env.AZURE_CONTAINER_REGISTRY_NAME || 'acragent365bridge';
const speechResourceGroup = process.env.SPEECH_RESOURCE_GROUP || 'rg-avatar-foundry';
const speechAccount = process.env.SPEECH_ACCOUNT_NAME || 'speech-avatar-foundry';
const acsResourceGroup = process.env.ACS_RESOURCE_GROUP || 'rg-cassidy-ops-agent';
const acsName = process.env.ACS_RESOURCE_NAME || 'acs-cassidy';

const args = new Set(process.argv.slice(2));
const force = args.has('--force');
const updated = [];
const skipped = [];
const discovered = [];
const optionalBlankKeys = new Set([
  'ACS_SOURCE_USER_ID',
  'APPLICATIONINSIGHTS_CONNECTION_STRING',
  'AVATAR_BACKGROUND_URL',
  'SPEECH_RESOURCE_KEY',
]);
const azureCli = 'az';

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

function envLine(key, value) {
  if (value === undefined || value === null) return `${key}=`;
  const stringValue = String(value).trim();
  if (/\s|#|=/.test(stringValue)) return `${key}=${JSON.stringify(stringValue)}`;
  return `${key}=${stringValue}`;
}

function isPlaceholder(value) {
  return !value || /^<.*>$/.test(value) || /your-|example|\.\.\.|optional-/i.test(value);
}

function runAz(azArgs, options = {}) {
  try {
    return execFileSync(azureCli, azArgs, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      timeout: options.timeoutMs || 90_000,
      windowsHide: true,
    }).trim();
  } catch (error) {
    if (!options.allowFailure) {
      const stderr = Buffer.isBuffer(error.stderr) ? error.stderr.toString('utf8') : '';
      throw new Error(`az ${azArgs.slice(0, 2).join(' ')} failed${stderr ? `: ${stderr.trim()}` : ''}`);
    }
    return '';
  }
}

function runAzJson(azArgs, options = {}) {
  const output = runAz(azArgs, options);
  if (!output) return options.defaultValue ?? null;
  return JSON.parse(output);
}

function addValue(values, key, value, options = {}) {
  if ((value === undefined || value === null || String(value).trim() === '') && !options.allowEmpty) return;
  values[key] = { value: String(value).trim(), secret: Boolean(options.secret), overwrite: Boolean(options.overwrite) };
  discovered.push({ key, secret: Boolean(options.secret) });
}

function replaceOrAppend(lines, existing, key, valueMeta) {
  const lineIndex = lines.findIndex((line) => new RegExp(`^${key}\\s*=`).test(line));
  const currentValue = existing[key];
  const shouldWrite = force || valueMeta.overwrite || isPlaceholder(currentValue);
  if (!shouldWrite) {
    skipped.push(key);
    return lines;
  }

  const replacement = envLine(key, valueMeta.value);
  if (lineIndex >= 0) {
    lines[lineIndex] = replacement;
  } else {
    lines.push(replacement);
  }
  updated.push(key);
  return lines;
}

if (!fs.existsSync(targetPath)) {
  if (!fs.existsSync(templatePath)) {
    console.error('[env] Missing .env and .env.template.');
    process.exit(1);
  }
  fs.copyFileSync(templatePath, targetPath);
}

runAz(['config', 'set', 'extension.use_dynamic_install=yes_without_prompt'], { allowFailure: true, timeoutMs: 30_000 });
runAz(['account', 'set', '--subscription', subscriptionId], { allowFailure: false, timeoutMs: 30_000 });

const existing = parseEnvFile(targetPath);
const values = {};

const hostName = runAz([
  'webapp', 'show',
  '--resource-group', morganResourceGroup,
  '--name', morganWebApp,
  '--query', 'defaultHostName',
  '--output', 'tsv',
], { allowFailure: true });
if (hostName) {
  addValue(values, 'BASE_URL', `https://${hostName}`, { overwrite: true });
  addValue(values, 'PUBLIC_HOSTNAME', hostName, { overwrite: true });
}

const aiAccount = runAzJson([
  'cognitiveservices', 'account', 'show',
  '--resource-group', morganResourceGroup,
  '--name', morganAiAccount,
  '--query', '{endpoint:properties.endpoint,location:location}',
  '--output', 'json',
], { allowFailure: true, defaultValue: null });
if (aiAccount?.endpoint) {
  addValue(values, 'AZURE_OPENAI_ENDPOINT', aiAccount.endpoint, { overwrite: true });
  addValue(values, 'AZURE_AI_SERVICES_ENDPOINT', aiAccount.endpoint, { overwrite: true });
  addValue(values, 'VOICELIVE_ENDPOINT', aiAccount.endpoint, { overwrite: true });
  addValue(values, 'FOUNDRY_PROJECT_ENDPOINT', `https://${morganAiAccount}.services.ai.azure.com/api/projects/${morganFoundryProject}`, { overwrite: true });
}

const deployments = runAzJson([
  'cognitiveservices', 'account', 'deployment', 'list',
  '--resource-group', morganResourceGroup,
  '--name', morganAiAccount,
  '--query', '[].{name:name,model:properties.model.name}',
  '--output', 'json',
], { allowFailure: true, defaultValue: [] });
const deployment = Array.isArray(deployments)
  ? deployments.find((item) => item.name && /realtime|gpt-4o|gpt/i.test(`${item.name} ${item.model || ''}`))
  : null;
if (deployment?.name) {
  addValue(values, 'AZURE_OPENAI_DEPLOYMENT', deployment.name, { overwrite: true });
  addValue(values, 'AZURE_OPENAI_REALTIME_DEPLOYMENT', deployment.name, { overwrite: true });
  addValue(values, 'VOICELIVE_MODEL', deployment.name, { overwrite: true });
}

const speech = runAzJson([
  'cognitiveservices', 'account', 'show',
  '--resource-group', speechResourceGroup,
  '--name', speechAccount,
  '--query', '{id:id,endpoint:properties.endpoint,location:location}',
  '--output', 'json',
], { allowFailure: true, defaultValue: null });
if (speech?.location) {
  addValue(values, 'SPEECH_REGION', speech.location, { overwrite: true });
}
if (speech?.endpoint) {
  addValue(values, 'AZURE_SPEECH_ENDPOINT', speech.endpoint, { overwrite: true });
}
if (speech?.id) {
  addValue(values, 'SPEECH_RESOURCE_ID', speech.id, { overwrite: true });
}
const speechKey = runAz([
  'cognitiveservices', 'account', 'keys', 'list',
  '--resource-group', speechResourceGroup,
  '--name', speechAccount,
  '--query', 'key1',
  '--output', 'tsv',
], { allowFailure: true });
addValue(values, 'SPEECH_RESOURCE_KEY', speechKey, { secret: true });
if (!speechKey) {
  addValue(values, 'SPEECH_RESOURCE_KEY', '', { secret: true, allowEmpty: true });
}

const acr = runAz([
  'acr', 'show',
  '--resource-group', acrResourceGroup,
  '--name', acrName,
  '--query', 'name',
  '--output', 'tsv',
], { allowFailure: true });
addValue(values, 'AZURE_CONTAINER_REGISTRY_NAME', acr, { overwrite: true });

const workspace = runAzJson([
  'monitor', 'log-analytics', 'workspace', 'list',
  '--resource-group', acrResourceGroup,
  '--query', '[0].{customerId:customerId}',
  '--output', 'json',
], { allowFailure: true, defaultValue: null });
if (workspace?.customerId) {
  addValue(values, 'LOG_ANALYTICS_WORKSPACE_ID', workspace.customerId, { overwrite: true });
  addValue(values, 'PURVIEW_AUDIT_WORKSPACE_ID', workspace.customerId, { overwrite: true });
}

const acsConnectionString = runAz([
  'communication', 'list-key',
  '--resource-group', acsResourceGroup,
  '--name', acsName,
  '--query', 'primaryConnectionString',
  '--output', 'tsv',
], { allowFailure: true });
addValue(values, 'ACS_CONNECTION_STRING', acsConnectionString, { secret: true });
addValue(values, 'ACS_SOURCE_USER_ID', '', { allowEmpty: true });
addValue(values, 'APPLICATIONINSIGHTS_CONNECTION_STRING', '', { allowEmpty: true });

if (existing.CFO_EMAIL && !isPlaceholder(existing.CFO_EMAIL)) {
  const cfoObjectId = runAz([
    'ad', 'user', 'show',
    '--id', existing.CFO_EMAIL,
    '--query', 'id',
    '--output', 'tsv',
  ], { allowFailure: true });
  addValue(values, 'CFO_TEAMS_USER_AAD_OID', cfoObjectId, { overwrite: true });
}

let lines = fs.readFileSync(targetPath, 'utf8').split(/\r?\n/);
if (lines.length && lines[lines.length - 1] === '') lines = lines.slice(0, -1);
for (const [key, valueMeta] of Object.entries(values)) {
  lines = replaceOrAppend(lines, existing, key, valueMeta);
}
fs.writeFileSync(targetPath, `${lines.join('\n')}\n`, 'utf8');

const finalEnv = parseEnvFile(targetPath);
const unresolved = Object.keys(finalEnv).filter((key) => isPlaceholder(finalEnv[key]) && !(finalEnv[key] === '' && optionalBlankKeys.has(key)));
const intentionallyBlank = Object.keys(finalEnv).filter((key) => finalEnv[key] === '' && optionalBlankKeys.has(key));
const secretKeys = discovered.filter((item) => item.secret).map((item) => item.key).sort();

console.log(`[env] Azure CLI subscription set to ${subscriptionId}.`);
console.log(`[env] Discovered ${discovered.length} Azure-derived value(s).`);
console.log(`[env] Updated keys: ${Array.from(new Set(updated)).sort().join(', ') || '(none)'}`);
console.log(`[env] Preserved existing keys: ${Array.from(new Set(skipped)).sort().join(', ') || '(none)'}`);
console.log(`[env] Secret keys handled without printing values: ${secretKeys.join(', ') || '(none)'}`);
console.log(`[env] Intentionally blank optional keys: ${intentionallyBlank.sort().join(', ') || '(none)'}`);
console.log(`[env] Still unresolved placeholders: ${unresolved.sort().join(', ') || '(none)'}`);