const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const deployDir = path.join(projectRoot, '.deploy');

const hostedEnvKeys = [
  'NODE_ENV',
  'HOST',
  'MORGAN_FOUNDRY_RESPONSES_ONLY',
  'AZURE_CLIENT_ID',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_API_VERSION',
  'AZURE_OPENAI_DEPLOYMENT',
  'AZURE_OPENAI_REALTIME_ENDPOINT',
  'AZURE_OPENAI_REALTIME_DEPLOYMENT',
  'FABRIC_WORKSPACE_ID',
  'FABRIC_LAKEHOUSE_ID',
  'FABRIC_SEMANTIC_MODEL_ID',
  'POWERBI_SEMANTIC_MODEL_ID',
  'MCP_PLATFORM_ENDPOINT',
  'MicrosoftAppId',
  'MicrosoftAppTenantId',
  'MicrosoftAppPassword',
  'FINANCE_TEAMS_CHANNEL_ID',
  'CFO_EMAIL',
  'CFO_TEAMS_USER_AAD_OID',
  'VOICELIVE_ENDPOINT',
  'VOICELIVE_MODEL',
  'VOICE_NAME',
  'AVATAR_CHARACTER',
  'AVATAR_STYLE',
  'AVATAR_DISPLAY_NAME',
  'SPEECH_REGION',
  'AZURE_AI_SERVICES_ENDPOINT',
  'AZURE_SPEECH_ENDPOINT',
  'SPEECH_RESOURCE_ID',
  'SPEECH_RESOURCE_KEY',
  'ACS_CONNECTION_STRING',
  'ACS_SOURCE_USER_ID',
  'BASE_URL',
  'PUBLIC_HOSTNAME',
  'APPLICATIONINSIGHTS_CONNECTION_STRING',
  'APPLICATIONINSIGHTS_RESOURCE_ID',
  'PURVIEW_AUDIT_WORKSPACE_ID',
  'PURVIEW_AUDIT_ENABLED',
  'COSMOS_DB_ENDPOINT',
  'COSMOS_DB_DATABASE',
  'COSMOS_DB_CONTAINER',
  'SCHEDULED_SECRET',
  'AUTONOMOUS_WORKDAY_ENABLED',
  'AUTONOMOUS_WORKDAY_TIME_ZONE',
  'AUTONOMOUS_WORKDAY_START_HOUR',
  'AUTONOMOUS_WORKDAY_END_HOUR',
  'AUTONOMOUS_WORKDAY_INTERVAL_MINUTES',
  'MORGAN_MISSION_STATE_FILE',
  'AI_KANBAN_AGENT_ENDPOINT',
  'AI_KANBAN_AGENT_BEARER_TOKEN',
  'AI_KANBAN_AGENT_SHARED_SECRET',
  'CASSIDY_AGENT_ENDPOINT',
  'CASSIDY_AGENT_BEARER_TOKEN',
  'CASSIDY_AGENT_SHARED_SECRET',
  'AVATAR_AGENT_ENDPOINT',
  'AVATAR_AGENT_BEARER_TOKEN',
  'AVATAR_AGENT_SHARED_SECRET',
  'SUB_AGENT_BEARER_TOKEN',
  'SUB_AGENT_SHARED_SECRET'
];

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = 'true';
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
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

function shouldConfirmEnvPayload(args) {
  return args['confirm-env-payload'] === 'yes' || process.env.CONFIRM_FOUNDRY_HOSTED_ENV_PAYLOAD === 'yes';
}

function buildEnvironmentVariables(args) {
  const envFilePath = path.resolve(projectRoot, args['env-file'] || '.env');
  const envFile = parseEnvFile(envFilePath);
  const includeRealValues = shouldConfirmEnvPayload(args);
  const defaults = {
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    MORGAN_FOUNDRY_RESPONSES_ONLY: 'true',
    AUTONOMOUS_WORKDAY_ENABLED: 'false',
    AUTONOMOUS_WORKDAY_TIME_ZONE: 'Australia/Sydney',
    AUTONOMOUS_WORKDAY_START_HOUR: '9',
    AUTONOMOUS_WORKDAY_END_HOUR: '17',
    AUTONOMOUS_WORKDAY_INTERVAL_MINUTES: '25'
  };

  const environmentVariables = {};
  const missing = [];
  const withheld = [];

  for (const key of hostedEnvKeys) {
    const value = process.env[key] || envFile[key] || defaults[key];
    if (typeof value === 'undefined' || isPlaceholder(value)) {
      if (defaults[key]) {
        environmentVariables[key] = defaults[key];
      } else {
        missing.push(key);
      }
      continue;
    }
    if (includeRealValues || defaults[key]) {
      environmentVariables[key] = value;
    } else {
      environmentVariables[key] = `<set-${key}>`;
      withheld.push(key);
    }
  }

  return { environmentVariables, missing, withheld, envFilePath, includeRealValues };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 12);
  const agentName = args['agent-name'] || process.env.MORGAN_FOUNDRY_AGENT_NAME || 'morgan-digital-cfo-hosted';
  const image = args.image || process.env.MORGAN_FOUNDRY_IMAGE || `crbdoregvn6di7y.azurecr.io/morgan-digital-cfo:${timestamp}`;
  const projectEndpoint = args['project-endpoint'] || process.env.FOUNDRY_PROJECT_ENDPOINT || 'https://ai-account-bdoregvn6di7y.services.ai.azure.com/api/projects/ai-project-morgan-hosted-ncus';
  const cpu = args.cpu || '1';
  const memory = args.memory || '2Gi';
  const outputPath = path.resolve(projectRoot, args.output || path.join('.deploy', 'morgan-foundry-hosted-agent-definition.json'));
  const registryName = (image.match(/^([^.]+)\.azurecr\.io\//)?.[1]) || args.acr || 'crbdoregvn6di7y';
  const repositoryTag = image.replace(/^[^/]+\//, '');

  const { environmentVariables, missing, withheld, envFilePath, includeRealValues } = buildEnvironmentVariables({ ...args, 'project-endpoint': projectEndpoint });

  const payload = {
    projectEndpoint,
    agentName,
    agentDefinition: {
      kind: 'hosted',
      image,
      cpu,
      memory,
      container_protocol_versions: [
        { protocol: 'responses', version: '1.0.0' }
      ],
      environment_variables: environmentVariables
    },
    creationOptions: {
      description: 'Morgan Digital CFO hosted-agent container for Microsoft Foundry. Runs the working Morgan D-CFO runtime, /responses protocol, Mission Control, autonomous CFO workday, tool loop, observability, and voice/readiness surfaces.',
      metadata: {
        source: 'Morgan-D-CFO',
        deploymentType: 'foundry-hosted-agent',
        protocol: 'responses/1.0.0',
        image,
        generatedAt: new Date().toISOString(),
        envPayloadConfirmed: String(includeRealValues)
      }
    },
    build: {
      acr: registryName,
      repository: 'morgan-digital-cfo',
      image,
      cloudBuildCommand: `az acr build --registry ${registryName} --image ${repositoryTag} --platform linux/amd64 --file Dockerfile .`
    },
    readiness: {
      envFile: envFilePath,
      realEnvValuesIncluded: includeRealValues,
      missingOptionalKeys: missing,
      placeholderKeysBecausePayloadNotConfirmed: withheld,
      warning: includeRealValues
        ? 'This payload may contain secrets and should be handled as a private deployment artifact.'
        : 'Real env values were not included. Re-run with --confirm-env-payload yes when ready to create the hosted agent.'
    }
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');

  const summary = {
    outputPath,
    projectEndpoint,
    agentName,
    image,
    realEnvValuesIncluded: includeRealValues,
    placeholderKeyCount: withheld.length,
    missingOptionalKeyCount: missing.length
  };
  console.log(JSON.stringify(summary, null, 2));
}

main();
