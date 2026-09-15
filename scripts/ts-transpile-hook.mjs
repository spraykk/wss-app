// Load/resolve hooks that transpile the verbatim TypeScript source graph so it
// can run under `node --experimental-strip-types`. The delivered core files use
// bare (non-`type`) imports of type-only names across modules
// (e.g. `import { TimeBand } from '../types'`). Node's type-stripping keeps such
// import statements, causing a runtime "does not provide an export" error.
// TypeScript's own transpiler correctly elides those type-only imports, so we
// transpile each .ts module through `tsc` once and serve the resulting JS.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workDir = mkdtempSync(join(tmpdir(), 'wss-ts-'));

function transpile(sourcePath) {
  const inFile = join(workDir, 'in.ts');
  const outFile = join(workDir, 'in.js');
  writeFileSync(inFile, readFileSync(sourcePath, 'utf8'));
  execFileSync('tsc', ['--ignoreConfig', '--isolatedModules', '--noCheck', '--module', 'esnext', '--target', 'es2022', '--outDir', workDir, inFile], { stdio: 'pipe' });
  return readFileSync(outFile, 'utf8');
}

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-zA-Z0-9]+$/.test(specifier)) {
    const parentPath = context.parentURL ? fileURLToPath(new URL(specifier, context.parentURL)) : null;
    if (parentPath && existsSync(`${parentPath}.ts`)) {
      return nextResolve(pathToFileURL(`${parentPath}.ts`).href, context);
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts')) {
    const source = transpile(fileURLToPath(url));
    return { format: 'module', shortCircuit: true, source };
  }
  return nextLoad(url, context);
}
