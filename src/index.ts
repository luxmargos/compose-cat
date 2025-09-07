import { Command } from 'commander';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseDotenv } from 'dotenv';
import packageJson from '../package.json' with { type: 'json' };
import { e } from 'vite-node/dist/index-z0R8hVRu.js';

type StringMap = Record<string, string>;

const PACKAGE_VERSION = packageJson.version;

const defaultBins = ['docker compose', 'podman compose', 'docker-compose', 'podman-compose'];

function getPrefix(): string {
  return process.env.COMPOSE_PLUS_PREFIX || 'CMP_';
}

function getDotenvPrefix(): string {
  return process.env.COMPOSE_PLUS_DOTENV_PREFIX || '.env';
}

function envKey(
  key: 'BASE_DIR' | 'DATA_BASE_DIR' | 'INJECT_DIR' | 'STORE_DIR' | 'COMPOSE_BIN' | 'PROJECT_NAME',
  prefix = getPrefix(),
) {
  return `${prefix}${key}`;
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

function normalizeProfiles(values?: string[] | string): string[] {
  if (!values) return [];
  const arr = Array.isArray(values) ? values : [values];
  const out: string[] = [];
  for (const v of arr) {
    if (!v) continue;
    for (const part of v.split(',')) {
      const s = part.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

function detectDotenvFilesAndEnv(profileFromCli?: string[] | string): {
  envFiles: string[];
  mergedEnv: StringMap;
  profiles: string[];
} {
  // Start with defaults; allow OS env to change prefix and dotenv prefix.
  const dotenvPrefix = getDotenvPrefix();

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

  // Determine profiles: CLI overrides env/dotenv
  let profiles: string[] = [];
  const cliProfiles = normalizeProfiles(profileFromCli);
  if (cliProfiles.length > 0) {
    profiles = cliProfiles;
  }

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

  return { envFiles: allFiles, mergedEnv: finalMerged, profiles: profiles };
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

function ensureDataDirs(env: StringMap): {
  baseDir: string;
  dataBaseDir: string;
  injectDir: string;
  storeDir: string;
} {
  const prefix = getPrefix();
  const baseDir = env[envKey('BASE_DIR', prefix)] || process.cwd();
  const dataBaseDir = env[envKey('DATA_BASE_DIR', prefix)] || path.join(baseDir, 'container-data');
  const injectDir = env[envKey('INJECT_DIR', prefix)] || path.join(dataBaseDir, 'inject');
  const storeDir = env[envKey('STORE_DIR', prefix)] || path.join(dataBaseDir, 'store');

  env[envKey('BASE_DIR', prefix)] = baseDir;
  env[envKey('DATA_BASE_DIR', prefix)] = dataBaseDir;
  env[envKey('INJECT_DIR', prefix)] = injectDir;
  env[envKey('STORE_DIR', prefix)] = storeDir;

  mkdirSync(path.resolve(injectDir), { recursive: true });
  mkdirSync(path.resolve(storeDir), { recursive: true });

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

function checkBinOrThrow(value: string | undefined, candidates: string[]) {
  if (!value) {
    console.error('compose-plus: No compose binary detected. Tried:', candidates.join(' | '));
    process.exitCode = 1;
    return false;
  }

  return true;
}

function buildComposeArgs(
  projectNameFromArg: string | undefined,
  envFiles: string[],
  mergedEnv: StringMap,
  profiles: string[],
  extraArgs: string[],
): string[] {
  const args: string[] = [];
  const prefix = getPrefix();
  if (projectNameFromArg) {
    args.push('-p', projectNameFromArg);
  } else if (mergedEnv[envKey('PROJECT_NAME', prefix)]) {
    args.push('-p', mergedEnv[envKey('PROJECT_NAME', prefix)]!);
  }

  for (const p of profiles) {
    args.push('--profile', p);
  }

  for (const f of envFiles) {
    args.push('--env-file', f);
  }

  args.push(...extraArgs);
  return args;
}

function extractOptions(composeArgs: string[], options: any) {
  const projectName = options.projectName as string | undefined;
  const { envFiles, mergedEnv, profiles } = detectDotenvFilesAndEnv(options.profile);
  const { storeDir } = ensureDataDirs(mergedEnv);

  const prefix = getPrefix();
  const userBins: string[] = Array.isArray(options.cmpBin) ? (options.cmpBin as string[]) : [];
  const envBins = parseCsv(mergedEnv[envKey('COMPOSE_BIN', prefix)]);
  let composeBin = '';
  if (userBins.length > 0) {
    const foundBin = detectComposeBin(userBins) ?? '';
    if (!checkBinOrThrow(foundBin, userBins)) return;
    composeBin = foundBin;
  } else if (envBins.length > 0) {
    const foundBin = detectComposeBin(envBins) ?? '';
    if (!checkBinOrThrow(foundBin, envBins)) return;
    composeBin = foundBin;
  } else {
    const foundBin = detectComposeBin(defaultBins) ?? '';
    if (!checkBinOrThrow(foundBin, defaultBins)) return;
    composeBin = foundBin;
  }

  const args = buildComposeArgs(projectName, envFiles, mergedEnv, profiles, composeArgs || []);

  return { composeBin, args, mergedEnv, storeDir };
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
    .enablePositionalOptions()
    .option('--cmp-bin <value...>', 'Override compose binary candidates (priority order)')
    .option(
      '-p, --project-name <value>',
      'Compose project name to use (overrides CMP_PROJECT_NAME)',
    )
    .option('--profile <value...>', 'Profiles to use (comma-separated or multiple)')
    .argument('[composeArgs...]', 'Compose subcommand and options to pass through')
    .action(async (composeArgs: string[], options) => {
      const extracted = extractOptions(composeArgs, options);
      if (!extracted) return;
      const { composeBin, args, mergedEnv, storeDir } = extracted;
      const code = await runCompose(composeBin, args, {
        ...process.env,
        ...mergedEnv,
      });
      process.exitCode = code;
    });

  program
    .command('cmp-clean')
    .allowUnknownOption(true)
    .enablePositionalOptions()
    .option('--cmp-bin <value...>', 'Override compose binary candidates (priority order)')
    .option(
      '-p, --project-name <value>',
      'Compose project name to use (overrides CMP_PROJECT_NAME)',
    )
    .option('--profile <value...>', 'Profiles to use (comma-separated or multiple)')
    .argument('[composeArgs...]', 'Compose subcommand and options to pass through')
    .action(async (composeArgs: string[], options) => {
      const extracted = extractOptions(composeArgs, options);
      if (!extracted) return;
      const { composeBin, args, mergedEnv, storeDir } = extracted;

      // rm -fsv
      let code = await runCompose(composeBin, [...(args || []), 'rm', '-fsv'], {
        ...process.env,
        ...mergedEnv,
      });
      if (code !== 0) return process.exit((process.exitCode = code));

      // down --volumes
      code = await runCompose(composeBin, [...(args || []), 'down', '--volumes'], {
        ...process.env,
        ...mergedEnv,
      });
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
    .enablePositionalOptions()
    .option('--cmp-bin <value...>', 'Override compose binary candidates (priority order)')
    .option(
      '-p, --project-name <value>',
      'Compose project name to use (overrides CMP_PROJECT_NAME)',
    )
    .option('--profile <value...>', 'Profiles to use (comma-separated or multiple)')
    .argument('[composeArgs...]', 'Compose subcommand and options to pass through')
    .action(async (composeArgs: string[], options) => {
      const extracted = extractOptions(composeArgs, options);
      if (!extracted) return;
      const { composeBin, args, mergedEnv, storeDir } = extracted;

      // rm -fsv
      let code = await runCompose(composeBin, [...(args || []), 'rm', '-fsv'], {
        ...process.env,
        ...mergedEnv,
      });
      if (code !== 0) return process.exit((process.exitCode = code));

      // down --volumes
      code = await runCompose(
        composeBin,
        [...(args || []), 'down', '--rmi', 'local', '--volumes'],
        {
          ...process.env,
          ...mergedEnv,
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

  await program.parseAsync(process.argv);
}

// Run
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
