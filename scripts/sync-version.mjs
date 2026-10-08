// Copies the version from package.json into manifest.json. Runs as npm's "version" script, so
// `npm version <patch|minor|major>` bumps both files in the same commit.
import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
// Only the version line is touched, so the manifest keeps its formatting.
const line = /^(\s*"version":\s*")[^"]*(")/m;
const manifest = readFileSync('manifest.json', 'utf8');
if (!line.test(manifest)) throw new Error('no "version" line found in manifest.json');
writeFileSync('manifest.json', manifest.replace(line, `$1${version}$2`));
console.log(`manifest.json -> ${version}`);
