import { spawn } from 'child_process';
import { readdir } from 'fs/promises';
import path from 'path';

const run = (command, args, options = {}) => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        const error = new Error(`${command} ${args.join(' ')} exited with code ${code}`);
        error.stdout = stdout;
        error.stderr = stderr;
        error.code = code;
        reject(error);
      }
    });

    child.on('error', reject);
  });
};

const getMigrationDirectories = async () => {
  const migrationsPath = path.join(process.cwd(), 'prisma', 'migrations');
  const entries = await readdir(migrationsPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== 'migration_lock.toml')
    .sort();
};

const baselineExistingDatabase = async () => {
  const migrationDirs = await getMigrationDirectories();

  if (migrationDirs.length === 0) {
    console.warn('No Prisma migrations found to mark as applied.');
    return;
  }

  console.log('Database appears to be pre-existing. Marking migrations as applied to create a baseline...');

  for (const migrationName of migrationDirs) {
    await run('prisma', ['migrate', 'resolve', '--applied', migrationName], {
      env: process.env
    });
  }
};

const deploy = async () => {
  try {
    await run('prisma', ['migrate', 'deploy'], { env: process.env });
  } catch (error) {
    if (typeof error.stderr === 'string' && error.stderr.includes('P3005')) {
      await baselineExistingDatabase();
      await run('prisma', ['migrate', 'deploy'], { env: process.env });
      return;
    }

    throw error;
  }
};

deploy().catch((error) => {
  console.error(error.message);
  process.exit(error.code ?? 1);
});
