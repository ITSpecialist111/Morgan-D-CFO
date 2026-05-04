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

const assetDirs = [
  ['docs/avatar-backgrounds', 'dist/voice/assets', /\.(jpe?g|png|webp|gif|svg)$/i],
];

for (const [sourceDirRel, targetDirRel, filter] of assetDirs) {
  const sourceDir = path.join(projectRoot, sourceDirRel);
  const targetDir = path.join(projectRoot, targetDirRel);
  if (!fs.existsSync(sourceDir)) {
    console.log(`[build] asset dir missing, skipping ${sourceDirRel}`);
    continue;
  }
  fs.mkdirSync(targetDir, { recursive: true });
  let copied = 0;
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (filter && !filter.test(entry.name)) continue;
    fs.copyFileSync(path.join(sourceDir, entry.name), path.join(targetDir, entry.name));
    copied += 1;
  }
  console.log(`[build] copied ${copied} asset(s) from ${sourceDirRel} -> ${targetDirRel}`);
}