const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

const files = [
  ['src/voice/voice.html', 'dist/voice/voice.html'],
  ['src/mission/mission-control.html', 'dist/mission/mission-control.html'],
  ['src/mission/cost-dashboard.html', 'dist/mission/cost-dashboard.html'],
];

for (const [sourceRel, targetRel] of files) {
  const source = path.join(projectRoot, sourceRel);
  const target = path.join(projectRoot, targetRel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  console.log(`[build] copied ${sourceRel} -> ${targetRel}`);
}