import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const directory = resolve(process.argv[2] ?? 'release/electron');
const extensions = new Set(['.deb', '.exe', '.dmg', '.zip']);
const files = (await readdir(directory)).filter((file) =>
  extensions.has(extname(file).toLowerCase()),
);

if (files.length === 0) {
  throw new Error(
    `No release artifacts were found in ${directory}. Run the platform packaging command successfully first.`,
  );
}

for (const file of files) {
  const path = join(directory, file);
  const digest = createHash('sha256').update(await readFile(path)).digest('hex');
  await writeFile(`${path}.sha256`, `${digest}  ${file}\n`, 'utf8');
}

console.info(`Generated SHA-256 files for ${files.length} artifact(s).`);
