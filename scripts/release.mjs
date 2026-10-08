// Assembles the loadable extension in release/x-oldest/ and zips it as
// release/x-oldest-<version>.zip. Run through `npm run release`, which builds first.
//
// The file list is read from manifest.json, so whatever the manifest loads is what ships.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

const NAME = 'x-oldest';
const OUT = 'release';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const files = new Set(['manifest.json', 'LICENSE', ...Object.values(manifest.icons)]);
for (const script of manifest.content_scripts) {
  for (const file of [...script.js, ...(script.css || [])]) files.add(file);
}

const dir = join(OUT, NAME);
rmSync(OUT, { recursive: true, force: true });
for (const file of files) {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  cpSync(file, join(dir, file));
}

// Zipped from inside the folder, so manifest.json sits at the top level of the archive.
const zip = `${NAME}-${manifest.version}.zip`;
execFileSync('zip', ['-r', '-q', '-X', join('..', zip), '.'], { cwd: dir });
console.log(`${dir}/  (${files.size} files)\n${join(OUT, zip)}`);
