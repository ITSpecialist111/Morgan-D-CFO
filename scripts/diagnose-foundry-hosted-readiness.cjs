const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function check(name, passed, details) {
  return { name, passed, details };
}

function main() {
  const packagePath = path.join(projectRoot, 'package.json');
  const dockerfilePath = path.join(projectRoot, 'Dockerfile');
  const responsesPath = path.join(projectRoot, 'src', 'foundry', 'responsesAdapter.ts');
  const foundryHostPath = path.join(projectRoot, 'src', 'foundryHost.ts');
  const metadataPath = path.join(projectRoot, '.foundry', 'agent-metadata.yaml');
  const datasetPath = path.join(projectRoot, '.foundry', 'datasets', 'morgan-digital-cfo-hosted-smoke-v1.jsonl');
  const evaluatorPath = path.join(projectRoot, '.foundry', 'evaluators', 'morgan-hosted-p0-smoke.yaml');
  const payloadPath = path.join(projectRoot, '.deploy', 'morgan-foundry-hosted-agent-definition.json');

  const packageJson = JSON.parse(read(packagePath) || '{}');
  const dockerfile = read(dockerfilePath);
  const responses = read(responsesPath);

  const checks = [
    check('package.json exists', fs.existsSync(packagePath), packagePath),
    check('build script exists', Boolean(packageJson.scripts?.build), packageJson.scripts?.build || null),
    check('start script exists', Boolean(packageJson.scripts?.start), packageJson.scripts?.start || null),
    check('Dockerfile exists', fs.existsSync(dockerfilePath), dockerfilePath),
    check('Dockerfile exposes 8088', /EXPOSE\s+8088/.test(dockerfile), 'Foundry hosted agents expect the container to listen on the exposed port.'),
    check('Dockerfile starts dist/foundryHost.js', /dist\/foundryHost\.js/.test(dockerfile), 'Runtime starts the dedicated Foundry Responses host.'),
    check('Dockerfile handles missing lockfile', /package-lock\.json/.test(dockerfile) && /npm install/.test(dockerfile), 'ACR build can proceed even when package-lock.json is absent.'),
    check('Foundry host exists', fs.existsSync(foundryHostPath), foundryHostPath),
    check('responses adapter exists', fs.existsSync(responsesPath), responsesPath),
    check('responses health route exists', /\/responses\/health/.test(responses), 'GET /responses/health is present.'),
    check('readiness route exists', /\/readiness/.test(responses), 'GET /readiness is present for platform health checks.'),
    check('responses post route exists', /server\.post\('\/responses'/.test(responses), 'POST /responses is present.'),
    check('Foundry metadata exists', fs.existsSync(metadataPath), metadataPath),
    check('P0 dataset exists', fs.existsSync(datasetPath), datasetPath),
    check('P0 evaluator metadata exists', fs.existsSync(evaluatorPath), evaluatorPath),
    check('hosted payload prepared', fs.existsSync(payloadPath), payloadPath)
  ];

  const failed = checks.filter((item) => !item.passed);
  const report = {
    date: new Date().toISOString(),
    status: failed.length ? 'blocked' : 'ready-for-acr-build-and-agent-update',
    checks,
    nextAction: failed.length
      ? 'Resolve failed checks, then run npm run foundry:prepare-hosted with a real ACR image.'
      : 'Build/push the container image, regenerate the payload with the real image and confirmed env values, then create/start the Foundry hosted agent.'
  };

  console.log(JSON.stringify(report, null, 2));
  process.exitCode = failed.length ? 1 : 0;
}

main();
