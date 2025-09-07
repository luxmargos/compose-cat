import { Command } from 'commander';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseDotenv } from 'dotenv';
import packageJson from '../package.json' with { type: 'json' };

type StringMap = Record<string, string>;

const PACKAGE_VERSION = packageJson.version;

function getPrefix(): string {
  return process.env.COMPOSE_PLUS_PREFIX || 'CMP';
}

function envKey(
  key:
    | 'PROFILE'
    | 'DOTENV_PREFIX'
    | 'BASE_DIR'
    | 'DATA_BASE_DIR'
    | 'INJECT_DIR'
    | 'STORE_DIR'
    | 'COMPOSE_BIN'
    | 'PROJECT_NAME',
  prefix = getPrefix(),
) {
  return `${prefix}_${key}`;
}

function readEnvFile(file: string): StringMap {
  try {
    const content = readFileSync(file, 'utf8');
    const parsed = parseDotenv(content);
    const result: StringMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string') result[k] = v;
    }
    return result;
  } catch {
    return {};
  }
}

function detectDotenvFilesAndEnv(): { files: string[]; mergedEnv: StringMap } {
  const prefix = getPrefix();
  // Start with defaults; allow OS env to change prefix and dotenv prefix.
  const dotenvPrefix = process.env[envKey('DOTENV_PREFIX', prefix)] || '.env';

  const baseFiles = [
    path.resolve(process.cwd(), `${dotenvPrefix}`),
    path.resolve(process.cwd(), `${dotenvPrefix}.local`),
  ];

  // Load base files to possibly discover PROFILE from them as well.
  const baseMerged = {} as StringMap;
  for (const f of baseFiles) {
    if (!existsSync(f)) continue;
    Object.assign(baseMerged, readEnvFile(f));
  }

  const profileRaw =
    process.env[envKey('PROFILE', prefix)] || baseMerged[envKey('PROFILE', prefix)] || '';
  const profiles = profileRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const profileFiles: string[] = [];
  for (const p of profiles) {
    profileFiles.push(
      path.resolve(process.cwd(), `${dotenvPrefix}.${p}`),
      path.resolve(process.cwd(), `${dotenvPrefix}.${p}.local`),
    );
  }

  const allFiles = [...baseFiles, ...profileFiles].filter((f) => existsSync(f));

  // Merge env in order; later files override earlier ones.
  const merged: StringMap = {};
  for (const f of allFiles) {
    Object.assign(merged, readEnvFile(f));
  }

  // Do not override actual OS env values.
  const finalMerged: StringMap = { ...merged };
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') finalMerged[k] = v;
  }

  return { files: allFiles, mergedEnv: finalMerged };
}

function parseCsv(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function detectComposeBin(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    // Try running "<candidate> version" and consider success if exitCode === 0
    const res = spawnSync(candidate + ' version', {
      stdio: 'ignore',
      shell: true,
      timeout: 2000,
    });
    if (res.status === 0) return candidate;
  }
  return undefined;
}

function ensureDataDirs(env: StringMap) {
  const prefix = getPrefix();
  const baseDir = env[envKey('BASE_DIR', prefix)] || process.cwd();
  const dataBaseDir = env[envKey('DATA_BASE_DIR', prefix)] || path.join(baseDir, 'container-data');
  const injectDir = env[envKey('INJECT_DIR', prefix)] || path.join(dataBaseDir, 'inject');
  const storeDir = env[envKey('STORE_DIR', prefix)] || path.join(dataBaseDir, 'store');

  mkdirSync(injectDir, { recursive: true });
  mkdirSync(storeDir, { recursive: true });

  return { baseDir, dataBaseDir, injectDir, storeDir };
}

async function runShellCommand(cmd: string, env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    console.log(`Running: ${cmd}`);
    const child = spawn(cmd, { stdio: 'inherit', shell: true, env });
    child.on('exit', (code, signal) => {
      if (typeof code === 'number') resolve(code);
      else resolve(signal ? 1 : 0);
    });
    child.on('error', () => resolve(1));
  });
}

async function runCompose(composeBin: string, args: string[], env: NodeJS.ProcessEnv) {
  const cmd = `${composeBin} ${args.map((a) => shellQuote(a)).join(' ')}`.trim();
  return runShellCommand(cmd, env);
}

function shellQuote(s: string): string {
  if (s === '') return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s; // no quoting needed
  return `'${s.replaceAll("'", "'\\''")}'`;
}

function buildComposeArgs(envFiles: string[], mergedEnv: StringMap, extraArgs: string[]): string[] {
  const args: string[] = [];
  const prefix = getPrefix();
  if (mergedEnv[envKey('PROJECT_NAME', prefix)]) {
    args.push('-p', mergedEnv[envKey('PROJECT_NAME', prefix)]!);
  }
  for (const f of envFiles) {
    args.push('--env-file', f);
  }
  args.push(...extraArgs);
  return args;
}

async function main() {
  const cwd = process.cwd();
  console.log(`compose-plus: cwd=${cwd}, version=${PACKAGE_VERSION}`);

  // Setup CLI
  const program = new Command();

  program
    .name('compose-plus')
    .description(
      'Compose Plus: pass-through wrapper for Docker/Podman Compose with env and helpers',
    )
    .version(PACKAGE_VERSION)
    .allowUnknownOption(true)
    .option('-b, --bin <value...>', 'Override compose binary candidates (priority order)')
    .argument('[composeArgs...]', 'Compose subcommand and options to pass through')
    .action(async (composeArgs: string[], options) => {
      const { files: envFiles, mergedEnv } = detectDotenvFilesAndEnv();
      const { storeDir } = ensureDataDirs(mergedEnv);

      const prefix = getPrefix();
      const userBins: string[] = Array.isArray(options.bin) ? (options.bin as string[]) : [];
      const envBins = parseCsv(mergedEnv[envKey('COMPOSE_BIN', prefix)]);
      // const defaultBins = ['docker compose', 'podman compose', 'docker-compose', 'podman-compose'];
      const defaultBins = ['xdocker compose', 'podman compose', 'docker-compose', 'podman-compose'];
      const candidates = [...userBins, ...envBins, ...defaultBins].filter(Boolean);

      const composeBin = detectComposeBin(candidates);
      if (!composeBin) {
        console.error('compose-plus: No compose binary detected. Tried:', candidates.join(' | '));
        process.exitCode = 1;
        return;
      }

      const args = buildComposeArgs(envFiles, mergedEnv, composeArgs || []);
      const code = await runCompose(composeBin, args, {
        ...process.env,
        ...mergedEnv,
        CMP_STORE_DIR: storeDir,
      });
      process.exitCode = code;
    });

  program
    .command('cmp-clean')
    .description('Stop and remove containers, networks/volumes, and clear store directory')
    .allowUnknownOption(true)
    .argument('[composeArgs...]', 'Extra args to pass to compose commands')
    .action(async (composeArgs: string[]) => {
      const { files: envFiles, mergedEnv } = detectDotenvFilesAndEnv();
      const { storeDir } = ensureDataDirs(mergedEnv);

      const prefix = getPrefix();
      const envBins = parseCsv(mergedEnv[envKey('COMPOSE_BIN', prefix)]);
      const defaultBins = ['docker compose', 'podman compose', 'docker-compose', 'podman-compose'];
      const composeBin = detectComposeBin([...envBins, ...defaultBins]);
      if (!composeBin) {
        console.error('compose-plus: No compose binary detected for cmp-clean');
        process.exit(1);
      }

      const baseArgs = buildComposeArgs(envFiles, mergedEnv, []);

      // rm -fsv
      let code = await runCompose(composeBin, [...baseArgs, 'rm', '-fsv', ...(composeArgs || [])], {
        ...process.env,
        ...mergedEnv,
        CMP_STORE_DIR: storeDir,
      });
      if (code !== 0) return process.exit((process.exitCode = code));

      // down --volumes
      code = await runCompose(
        composeBin,
        [...baseArgs, 'down', '--volumes', ...(composeArgs || [])],
        {
          ...process.env,
          ...mergedEnv,
          CMP_STORE_DIR: storeDir,
        },
      );
      if (code !== 0) return process.exit((process.exitCode = code));

      // rm -rf ${CMP_STORE_DIR}
      try {
        rmSync(storeDir, { recursive: true, force: true });
      } catch {
        // ignore
      }

      process.exit(0);
    });

  program
    .command('cmp-clean-i')
    .description('Like cmp-clean and also remove local images referenced by the project')
    .allowUnknownOption(true)
    .argument('[composeArgs...]', 'Extra args to pass to compose commands')
    .action(async (composeArgs: string[]) => {
      const { files: envFiles, mergedEnv } = detectDotenvFilesAndEnv();
      const { storeDir } = ensureDataDirs(mergedEnv);

      const prefix = getPrefix();
      const envBins = parseCsv(mergedEnv[envKey('COMPOSE_BIN', prefix)]);
      const defaultBins = ['docker compose', 'podman compose', 'docker-compose', 'podman-compose'];
      const composeBin = detectComposeBin([...envBins, ...defaultBins]);
      if (!composeBin) {
        console.error('compose-plus: No compose binary detected for cmp-clean-i');
        process.exit(1);
      }

      const baseArgs = buildComposeArgs(envFiles, mergedEnv, []);

      // rm -fsv
      let code = await runCompose(composeBin, [...baseArgs, 'rm', '-fsv', ...(composeArgs || [])], {
        ...process.env,
        ...mergedEnv,
        CMP_STORE_DIR: storeDir,
      });
      if (code !== 0) return process.exit((process.exitCode = code));

      // down --rmi local --volumes
      code = await runCompose(
        composeBin,
        [...baseArgs, 'down', '--rmi', 'local', '--volumes', ...(composeArgs || [])],
        { ...process.env, ...mergedEnv, CMP_STORE_DIR: storeDir },
      );
      if (code !== 0) return process.exit((process.exitCode = code));

      // rm -rf ${CMP_STORE_DIR}
      try {
        rmSync(storeDir, { recursive: true, force: true });
      } catch {
        // ignore
      }

      process.exit(0);
    });

  await program.parseAsync(process.argv);
}

// Run
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
