import { readFileSync } from 'node:fs';

const lock = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const unsupported = Object.entries(lock.packages).filter(([, pkg]) =>
  !pkg.dev && (pkg.hasInstallScript || pkg.os || pkg.cpu));
if (unsupported.length) {
  console.error('Production dependencies require a Linux-specific build:', unsupported.map(([name]) => name).join(', '));
  process.exit(1);
}
