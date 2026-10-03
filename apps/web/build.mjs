import { access, cp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const sourceDirectory = path.join(
  repositoryRoot,
  'artifacts',
  'landoversea',
  'dist',
  'public',
);
const outputDirectory = path.join(import.meta.dirname, 'dist');

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal
            ? `${command} was terminated by ${signal}.`
            : `${command} exited with code ${code ?? 'unknown'}.`,
        ),
      );
    });
  });

await rm(outputDirectory, { force: true, recursive: true });
await run('pnpm', ['--filter', '@workspace/landoversea', 'run', 'build']);
await access(path.join(sourceDirectory, 'index.html'));
await cp(sourceDirectory, outputDirectory, { recursive: true });
await access(path.join(outputDirectory, 'index.html'));

console.log(`Copied LandOverSEA web output to ${outputDirectory}.`);