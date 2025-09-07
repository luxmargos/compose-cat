import { Command } from 'commander';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseDotenv, populate } from 'dotenv';
import packageJson from '../package.json' with { type: 'json' };
import { e } from 'vite-node/dist/index-z0R8hVRu.js';

type StringMap = Record<string, string>;

const PACKAGE_VERSION = packageJson.version;

const defaultBins = ['docker compose', 'podman compose', 'docker-compose', 'podman-compose'];

const DEFAULT_PREFIX = 'CMP_';
const DEFAULT_DOTENV_PREFIX = '.env';

let prefixFromOptions: string | undefined = undefined;
let dotenvPrefixFromOptions: string | undefined = undefined;
function getPrefix(): string {
  return prefixFromOptions || process.env.COMPOSE_PLUS_PREFIX || DEFAULT_PREFIX;
}

function getDotenvPrefix(): string {
  return dotenvPrefixFromOptions || process.env.COMPOSE_PLUS_DOTENV_PREFIX || DEFAULT_DOTENV_PREFIX;
}

function envKey(
  key:
    | 'BASE_DIR'
    | 'DATA_BASE_DIR'
    | 'INJECT_DIR'
    | 'STORE_DIR'
    | 'COMPOSE_BIN'
    | 'PROJECT_NAME'
    | 'DETECTED_COMPOSE_BIN',
  prefix = getPrefix(),
) {
  return `${prefix}${key}`;
}

function mergeEnv(base: any, file: string): StringMap {
  try {
    const content = readFileSync(file, 'utf8');
    populate(base, parseDotenv(content));
    return base;
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
  const baseMerged = JSON.parse(JSON.stringify(process.env ?? {})) as StringMap;
  for (const f of baseFiles) {
    if (!existsSync(f)) continue;
    mergeEnv(baseMerged, f);
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
    mergeEnv(baseMerged, f);
  }

  return { envFiles: allFiles, mergedEnv: baseMerged, profiles: profiles };
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

  // Export to process.env for use by compose or other tools
  setProcessEnv(envKey('BASE_DIR', prefix), baseDir);
  setProcessEnv(envKey('DATA_BASE_DIR', prefix), dataBaseDir);
  setProcessEnv(envKey('INJECT_DIR', prefix), injectDir);
  setProcessEnv(envKey('STORE_DIR', prefix), storeDir);

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
    child.on('error', () => {
      resolve(1);
    });
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

function setProcessEnv(key: string, value: string) {
  process.env[key] = value;
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
  const projectName = projectNameFromArg || mergedEnv[envKey('PROJECT_NAME', prefix)] || '';
  if (projectName) {
    setProcessEnv(envKey('PROJECT_NAME', prefix), projectName);
    args.push('-p', projectName);
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

function prepare(composeArgs: string[], options: any) {
  const projectName = options.projectName as string | undefined;
  const { envFiles, mergedEnv, profiles } = detectDotenvFilesAndEnv(options.profile);
  const { storeDir } = ensureDataDirs(mergedEnv);

  prefixFromOptions = options.cmpPrefix as string | undefined;
  dotenvPrefixFromOptions = options.cmpDotenvPrefix as string | undefined;

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

  setProcessEnv(envKey('DETECTED_COMPOSE_BIN', prefix), composeBin);

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
    .option('--cmp-bin <value...>', 'Provide compose binary candidates in priority order')
    .option('--cmp-prefix <value>', 'Set the environment variable prefix (default: CMP_)')
    .option(
      '--cmp-dotenv-prefix <value>',
      'Set the dotenv file prefix to detect (default: .env)',
    )
    .option(
      '-p, --project-name <value>',
      'Compose project name (overrides CMP_PROJECT_NAME). You can also set CMP_PROJECT_NAME to persist it or vary by profile.',
    )
    .option('--profile <value...>', 'Profiles to use (comma-separated or repeat the flag)')
    .argument('[composeArgs...]', 'Compose subcommand and options to pass through')
    .action(async (composeArgs: string[], options) => {
      const extracted = prepare(composeArgs, options);
      if (!extracted) return;
      const { composeBin, args, mergedEnv, storeDir } = extracted;
      const code = await runCompose(composeBin, args, {
        ...process.env,
        // ...mergedEnv,
      });
      process.exitCode = code;
    });

  program
    .command('cmp-clean')
    .allowUnknownOption(true)
    .enablePositionalOptions()
    .option('--cmp-bin <value...>', 'Provide compose binary candidates in priority order')
    .option('--cmp-prefix <value>', 'Set the environment variable prefix (default: CMP_)')
    .option(
      '--cmp-dotenv-prefix <value>',
      'Set the dotenv file prefix to detect (default: .env)',
    )
    .option(
      '-p, --project-name <value>',
      'Compose project name (overrides CMP_PROJECT_NAME). You can also set CMP_PROJECT_NAME to persist it or vary by profile.',
    )
    .option('--profile <value...>', 'Profiles to use (comma-separated or repeat the flag)')
    .argument('[composeArgs...]', 'Compose subcommand and options to pass through')
    .action(async (composeArgs: string[], options) => {
      const extracted = prepare(composeArgs, options);
      if (!extracted) return;
      const { composeBin, args, mergedEnv, storeDir } = extracted;

      // rm -fsv
      let code = await runCompose(composeBin, [...(args || []), 'rm', '-fsv'], {
        ...process.env,
        // ...mergedEnv,
      });
      if (code !== 0) return process.exit((process.exitCode = code));

      // down --volumes
      code = await runCompose(composeBin, [...(args || []), 'down', '--volumes'], {
        ...process.env,
        // ...mergedEnv,
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
    .command('cmp-clean-i-local')
    .description('Like cmp-clean and also removes images for services without a custom tag')
    .allowUnknownOption(true)
    .enablePositionalOptions()
    .option('--cmp-bin <value...>', 'Provide compose binary candidates in priority order')
    .option('--cmp-prefix <value>', 'Set the environment variable prefix (default: CMP_)')
    .option(
      '--cmp-dotenv-prefix <value>',
      'Set the dotenv file prefix to detect (default: .env)',
    )
    .option(
      '-p, --project-name <value>',
      'Compose project name (overrides CMP_PROJECT_NAME). You can also set CMP_PROJECT_NAME to persist it or vary by profile.',
    )
    .option('--profile <value...>', 'Profiles to use (comma-separated or repeat the flag)')
    .argument('[composeArgs...]', 'Compose subcommand and options to pass through')
    .action(async (composeArgs: string[], options) => {
      const extracted = prepare(composeArgs, options);
      if (!extracted) return;
      const { composeBin, args, mergedEnv, storeDir } = extracted;

      // rm -fsv
      let code = await runCompose(composeBin, [...(args || []), 'rm', '-fsv'], {
        ...process.env,
        // ...mergedEnv,
      });
      if (code !== 0) return process.exit((process.exitCode = code));

      // down --rmi local --volumes
      code = await runCompose(
        composeBin,
        [...(args || []), 'down', '--rmi', 'local', '--volumes'],
        {
          ...process.env,
          // ...mergedEnv,
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
    .command('cmp-clean-i-all')
    .description('Like cmp-clean and also removes all images referenced by the services')
    .allowUnknownOption(true)
    .enablePositionalOptions()
    .option('--cmp-bin <value...>', 'Provide compose binary candidates in priority order')
    .option('--cmp-prefix <value>', 'Set the environment variable prefix (default: CMP_)')
    .option(
      '--cmp-dotenv-prefix <value>',
      'Set the dotenv file prefix to detect (default: .env)',
    )
    .option(
      '-p, --project-name <value>',
      'Compose project name (overrides CMP_PROJECT_NAME). You can also set CMP_PROJECT_NAME to persist it or vary by profile.',
    )
    .option('--profile <value...>', 'Profiles to use (comma-separated or repeat the flag)')
    .argument('[composeArgs...]', 'Compose subcommand and options to pass through')
    .action(async (composeArgs: string[], options) => {
      const extracted = prepare(composeArgs, options);
      if (!extracted) return;
      const { composeBin, args, mergedEnv, storeDir } = extracted;

      // rm -fsv
      let code = await runCompose(composeBin, [...(args || []), 'rm', '-fsv'], {
        ...process.env,
        // ...mergedEnv,
      });
      if (code !== 0) return process.exit((process.exitCode = code));

      // down --rmi all --volumes
      code = await runCompose(
        composeBin,
        [...(args || []), 'down', '--rmi', 'all', '--volumes'],
        {
          ...process.env,
          // ...mergedEnv,
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
