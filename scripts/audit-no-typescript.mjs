import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const violations = [];

for (const file of files) {
  const base = path.basename(file).toLowerCase();
  if (/\.tsx?$/.test(base) || base === 'tsconfig.json') {
    violations.push(`${file}: TypeScript file/configuration is not allowed`);
    continue;
  }
  if (path.extname(base) === '.svelte') {
    const source = await readFile(file, 'utf8');
    if (/<script\b[^>]*\blang\s*=\s*(['"])(?:ts|typescript)\1/i.test(source)) {
      violations.push(`${file}: Svelte TypeScript scripts are not allowed`);
    }
  }
}

if (violations.length) {
  console.error(`Zero-TypeScript audit failed:\n${violations.map((item) => ` - ${item}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Zero-TypeScript audit passed across ${files.length} repository files.`);
}
