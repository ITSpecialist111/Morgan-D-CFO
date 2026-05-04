const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const targetPath = path.join(projectRoot, '.env');
const templatePath = path.join(projectRoot, '.env.template');
const cassidyRootEnv = path.resolve(projectRoot, '..', 'Cassidy Autonomous', 'cassidy', '.env');
const cassidyFunctionEnv = path.resolve(projectRoot, '..', 'Cassidy Autonomous', 'cassidy', 'azure-function-trigger', '.env');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
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

function parseTemplateKeys() {
  const text = fs.readFileSync(templatePath, 'utf8');
  return text.split(/\r?\n/).map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    return match ? { key: match[1], value: match[2], line } : { line };
  });
}

function envLine(key, value) {
  if (value === undefined || value === null) return `${key}=`;
  const stringValue = String(value);
  if (/\s|#|=/.test(stringValue)) return `${key}=${JSON.stringify(stringValue)}`;
  return `${key}=${stringValue}`;
}

const args = new Set(process.argv.slice(2));
const force = args.has('--force');

if (!fs.existsSync(templatePath)) {
  console.error('[env] Missing .env.template.');
  process.exit(1);
}

if (fs.existsSync(targetPath) && !force) {
  console.error('[env] .env already exists. Re-run with --force to overwrite it.');
  process.exit(1);
}

const cassidyRoot = parseEnvFile(cassidyRootEnv);
const cassidyFunction = parseEnvFile(cassidyFunctionEnv);
const cassidy = { ...cassidyRoot, ...cassidyFunction };

const directKeys = [
  'MicrosoftAppId',
  'MicrosoftAppPassword',
  'MicrosoftAppTenantId',
  'NODE_ENV',
  'PORT',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_DEPLOYMENT',
  'MCP_PLATFORM_ENDPOINT',
  'SCHEDULED_SECRET',
  'AZURE_STORAGE_ACCOUNT',
  'agentic_connectionName',
];

const derived = {
  AGENT_NAME: 'Morgan',
  AGENT_ROLE: 'Digital CFO',
  USE_AGENTIC_AUTH: 'true',
  CFO_EMAIL: cassidy.MANAGER_EMAIL,
  FINANCE_TEAMS_CHANNEL_ID: cassidy.OPS_TEAMS_CHANNEL_ID,
  CASSIDY_AGENT_ENDPOINT: cassidy.CASSIDY_AGENT_URL,
};

const values = {};
for (const key of directKeys) {
  if (cassidy[key]) values[key] = cassidy[key];
}
for (const [key, value] of Object.entries(derived)) {
  if (value) values[key] = value;
}

const importedKeys = [];
const unresolvedKeys = [];
const output = parseTemplateKeys().map((entry) => {
  if (!entry.key) return entry.line;
  if (Object.prototype.hasOwnProperty.call(values, entry.key)) {
    importedKeys.push(entry.key);
    return envLine(entry.key, values[entry.key]);
  }
  if (/^<.*>$|your-|example|\.\.\./i.test(entry.value || '')) unresolvedKeys.push(entry.key);
  return entry.line;
});

fs.writeFileSync(targetPath, `${output.join('\n').replace(/\n*$/, '')}\n`, 'utf8');

console.log(`[env] Read Cassidy root env: ${Object.keys(cassidyRoot).length} key(s)`);
console.log(`[env] Read Cassidy function env: ${Object.keys(cassidyFunction).length} key(s)`);
console.log(`[env] Wrote Morgan .env with ${importedKeys.length} imported/derived key(s).`);
console.log(`[env] Imported keys: ${importedKeys.sort().join(', ') || '(none)'}`);
console.log(`[env] Still needs Morgan-specific values: ${unresolvedKeys.sort().join(', ') || '(none)'}`);
console.log('[env] Secret values were not printed. .env is ignored by git.');