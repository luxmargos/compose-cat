import { Command } from 'commander';
import { execSync, spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse as parseDotenv, populate } from 'dotenv';
import packageJson from '../package.json' with { type: 'json' };

type StringMap = Record<string, string>;

const PACKAGE_VERSION = packageJson.version;

// Compose binary names in the order we try them when the user does not specify one.
const defaultBins = ['docker compose', 'podman compose', 'docker-compose', 'podman-compose'];

const DEFAULT_PREFIX = 'CMPCAT_';
const DEFAULT_DOTENV_PREFIX = '.env';

let prefixFromOptions: string | undefined = undefined;
let dotenvPrefixFromOptions: string | undefined = undefined;
function getPrefix(): string {
  return prefixFromOptions || process.env.CMPCAT_ARG_PREFIX || DEFAULT_PREFIX;
}

function getDotenvPrefix(): string {
  return dotenvPrefixFromOptions || process.env.CMPCAT_ARG_DOTENV_PREFIX || DEFAULT_DOTENV_PREFIX;
}

// Resolve the env variable name with the current CMP_ prefix so we do not have to repeat
// interpolation logic everywhere.
function envKey(
  key:
    | 'COMPOSE_BIN'
    | 'PROJECT_NAME'
    | 'DETECTED_COMPOSE_BIN'
    | 'HOOK_EVENT'
    | 'HOOK_COMMAND'
    | 'HOOK_PLATFORM'
    | 'HOOK_BINARY'
    | 'HOOK_FILE',
  prefix = getPrefix(),
) {
  return `${prefix}${key}`;
}

// Load a dotenv file into the provided `base` object, returning the mutated reference. We keep the
// function defensive because hooks may reference optional files.
function mergeEnv(base: any, file: string): StringMap {
  try {
    const content = readFileSync(file, 'utf8');
    // console.log('##########################');
    // console.log(content);
    // console.log('before populate', base);
    populate(base, parseDotenv(content), { override: true });
    // console.log('after populate', base);
    // console.log('##########################');
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

/**
 * Detect which dotenv files are applicable and merge them to a single env object. CLI supplied
 * profiles override everything else, which allows per-profile .env overrides to kick in later.
 */
function detectDotenvFilesAndEnv(
  profileFromCli?: string[] | string,
  options?: { disableProfileBasedDotenv?: boolean },
): {
  envFiles: string[];
  mergedEnv: StringMap;
  profiles: string[];
} {
  // Start with defaults; allow OS env to change prefix and dotenv prefix.
  const dotenvPrefix = getDotenvPrefix();

  const baseDotenvFiles = [
    path.resolve(process.cwd(), `${dotenvPrefix}`),
    path.resolve(process.cwd(), `${dotenvPrefix}.local`),
  ].filter((f) => existsSync(f));

  // Load base files to possibly discover PROFILE from them as well.
  const baseMerged = JSON.parse(JSON.stringify(process.env ?? {})) as StringMap;
  for (const f of baseDotenvFiles) {
    console.log(`compose-cat: merging base dotenv file: ${f}`);
    mergeEnv(baseMerged, f);
  }

  // Determine profiles: CLI overrides env/dotenv
  let profiles: string[] = [];
  const cliProfiles = normalizeProfiles(profileFromCli);
  if (cliProfiles.length > 0) {
    profiles = cliProfiles;
  }

  let profileDotenvFiles: string[] = [];

  if (!options?.disableProfileBasedDotenv) {
    for (const p of profiles) {
      profileDotenvFiles.push(
        path.resolve(process.cwd(), `${dotenvPrefix}.${p}`),
        path.resolve(process.cwd(), `${dotenvPrefix}.${p}.local`),
      );
    }
  }

  profileDotenvFiles = profileDotenvFiles.filter((f) => existsSync(f));

  const allDotenvFiles = [...baseDotenvFiles, ...profileDotenvFiles];

  // Merge env in order; later files override earlier ones.
  for (const f of profileDotenvFiles) {
    // Base files may have already been merged above, but this keeps logging consistent with
    // the authoritative merge order.
    console.log(`compose-cat: merging profile dotenv file: ${f}`);
    mergeEnv(baseMerged, f);
  }

  return { envFiles: allDotenvFiles, mergedEnv: baseMerged, profiles: profiles };
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

// Thin wrapper around spawn that resolves with an exit code so hooks/compose invocations share the
// same logging and error handling surface.
async function runShellCommand(cmd: string, env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    console.log(`[RUNNING] ${cmd}`);
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
    console.error('compose-cat: No compose binary detected. Tried:', candidates.join(' | '));
    process.exitCode = 1;
    return false;
  }

  return true;
}

function setProcessEnv(key: string, value: string) {
  process.env[key] = value;
}

function buildComposeArgs(
  envFiles: string[],
  mergedEnv: StringMap,
  profiles: string[],
  extraArgs: string[],
): string[] {
  const args: string[] = [];

  for (const p of profiles) {
    args.push('--profile', p);
  }

  for (const f of envFiles) {
    args.push('--env-file', f);
  }

  args.push(...extraArgs);
  return args;
}

function setProfileEnvVariables(profiles: string[], mergedEnv: StringMap, prefix: string) {
  const profileKeyPrefix = `${prefix}PROFILE_`;
  const profilesKey = `${prefix}PROFILES`;

  for (const key of Object.keys(process.env)) {
    if (key.startsWith(profileKeyPrefix)) {
      delete process.env[key];
    }
  }
  for (const key of Object.keys(mergedEnv)) {
    if (key.startsWith(profileKeyPrefix)) {
      delete mergedEnv[key];
    }
  }

  if (profiles.length === 0) {
    delete process.env[profilesKey];
    delete mergedEnv[profilesKey];
    return;
  }

  const joinedProfiles = profiles.join(',');
  setProcessEnv(profilesKey, joinedProfiles);
  mergedEnv[profilesKey] = joinedProfiles;

  profiles.forEach((profile, index) => {
    const key = `${profileKeyPrefix}${index + 1}`;
    setProcessEnv(key, profile);
    mergedEnv[key] = profile;
  });
}

type HookStage = 'pre' | 'post';
type HookDef = {
  kind: 'global' | 'command';
  stage: HookStage;
  additionalHookName?: string; // present when kind === 'command'
  platform?: string;
  binary?: string;
  ext: string;
  file: string; // absolute path
};

function currentPlatform(): string[] {
  const platform = process.platform; // 'darwin' | 'linux' | 'win32' | ...
  if (platform === 'win32') return ['win32', 'windows'];
  if (platform === 'darwin') return ['darwin', 'macos'];
  if (platform === 'linux') return ['linux'];
  return [platform];
}

/**
 * Scan the working directory for hook scripts following the cmp.* naming convention and return the
 * ones that apply to the requested stage (and optional command specific hook).
 */
function discoverHooks(stage: HookStage, cmd: string | undefined): HookDef[] {
  const cwd = process.cwd();
  let entries: string[] = [];
  try {
    entries = readdirSync(cwd, { withFileTypes: false }) as unknown as string[];
  } catch {
    return [];
  }

  const platforms = currentPlatform();

  const isCmd = !!cmd;
  const filePatterns = isCmd
    ? [
        /^cmp\.(?<stage>[^.]+)\.(?<cmd>[^.]+)\.(?<ext>[^.]+)$/,
        /^cmp\.(?<stage>[^.]+)\.(?<cmd>[^.]+)\.(?<platformAndBinary>[^.]+)\.(?<ext>[^.]+)$/,
      ]
    : [
        /^cmp\.(?<stage>[^.]+)\.(?<ext>[^.]+)$/,
        /^cmp\.(?<stage>[^.]+)\.(?<platformAndBinary>[^.]+)\.(?<ext>[^.]+)$/,
      ];

  const firstHooks: HookDef[] = [];
  const secondHooks: HookDef[] = [];
  const thirdHooks: HookDef[] = [];

  for (const name of entries) {
    // Only simple filename matching at repo root
    if (!name.startsWith('cmp.')) continue;
    let m: RegExpMatchArray | null;
    let targetArray: HookDef[] | undefined = undefined;
    if ((m = name.match(filePatterns[0]))) {
      targetArray = firstHooks;
    } else if ((m = name.match(filePatterns[1]))) {
      targetArray = secondHooks;
    } else if ((m = name.match(filePatterns[2]))) {
      targetArray = thirdHooks;
    }

    if (m && targetArray) {
      const { stage: s, platformAndBinary, ext } = (m.groups || {}) as any;
      const pnbArr = platformAndBinary?.split('+') || [];
      let binary: string | undefined = undefined;

      if (s !== stage) continue;
      if (pnbArr.length > 0 && pnbArr[0].length > 0) {
        const p = pnbArr[0];
        if (!platforms.includes(p)) continue;
      }

      // if binary is specified, it must be non-empty
      if (pnbArr.length > 1 && pnbArr[1].length > 0) {
        binary = pnbArr[1];
      }

      targetArray.push({
        kind: isCmd ? 'command' : 'global',
        additionalHookName: cmd,
        stage,
        platform: platforms[0],
        binary,
        ext,
        file: path.resolve(cwd, name),
      });
    }
  }

  const hookDefs: HookDef[] = [...firstHooks, ...secondHooks, ...thirdHooks];
  return hookDefs;
}

// Execute hooks sequentially, short-circuiting on the first non-zero exit code so users can rely on
// hooks for guard rails.
async function runHooks(stage: HookStage, cmd: string | undefined, env: NodeJS.ProcessEnv) {
  const hooks = discoverHooks(stage, cmd);
  let exitCode = 0;
  for (const h of hooks) {
    const hookEnv = {
      ...env,
      [`${envKey('HOOK_EVENT', getPrefix())}`]: stage,
      [`${envKey('HOOK_COMMAND', getPrefix())}`]: cmd || '',
      [`${envKey('HOOK_PLATFORM', getPrefix())}`]: h.platform || '',
      [`${envKey('HOOK_BINARY', getPrefix())}`]: h.binary || '',
      [`${envKey('HOOK_FILE', getPrefix())}`]: h.file,
    } as NodeJS.ProcessEnv;

    const shellCommand = h.binary ? `${h.binary} ${h.file}` : h.file;
    const code = await runShellCommand(shellCommand, hookEnv);
    if (code !== 0) {
      exitCode = code;
      break;
    }
  }
  return exitCode;
}

/**
 * Central orchestration step: resolve env files, profiles, compose binary, hooks and compose
 * arguments so both the default and cmp-clean* commands behave consistently.
 */
function prepare(composeArgs: string[], options: any) {
  // console.log('##########################');
  // execSync('env', { stdio: 'inherit' });
  const { envFiles, mergedEnv, profiles } = detectDotenvFilesAndEnv(options.profile, options);

  prefixFromOptions = options.cmpPrefix as string | undefined;
  dotenvPrefixFromOptions = options.cmpDotenvPrefix as string | undefined;

  const prefix = getPrefix();
  setProfileEnvVariables(profiles, mergedEnv, prefix);
  // console.log('##########################');
  // execSync('env', { stdio: 'inherit' });

  // find compose binary
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

  const hooks = (options.cmpHook as string[] | undefined) ?? [];

  setProcessEnv(envKey('DETECTED_COMPOSE_BIN', prefix), composeBin);

  const args = buildComposeArgs(envFiles, mergedEnv, profiles, composeArgs || []);

  // Predefine COMPOSE_ variables for consistency
  for (const key in mergedEnv) {
    if (key.startsWith('COMPOSE_')) {
      process.env[key] = mergedEnv[key];
    }
  }

  console.log('##########################');
  console.log(mergedEnv);
  console.log('##########################');
  execSync('env', { stdio: 'inherit' });

  return { composeBin, args, mergedEnv, hooks };
}

// Attach shared CLI options and the action callback to a commander Command instance. Every entry
// point (default and cmp-clean*) calls this so we keep flag parsing identical.
function setupCommand(
  program: Command,
  action: (composeArgs: string[], options: any) => Promise<void>,
) {
  program
    .allowUnknownOption(true)
    .enablePositionalOptions()
    .option('--cmp-hook <value...>', 'Specify hook scripts to run')
    .option('--cmp-bin <value...>', 'Provide compose binary candidates in priority order')
    .option('--cmp-prefix <value>', 'Set the environment variable prefix (default: CMP_)')
    .option('--cmp-dotenv-prefix <value>', 'Set the dotenv file prefix to detect (default: .env)')
    .option('--profile <value...>', 'Profiles to use (comma-separated or repeat the flag)')
    .option(
      '--disable-profile-based-dotenv',
      'This disables automatic .env file detection based on profile names. (enabled by default).',
    )
    .argument('[composeArgs...]', 'Compose subcommand and options to pass through')
    .action(action);
  return program;
}

// CLI bootstrap: define commands, wire hooks, and pass everything to Commander.
async function main() {
  const cwd = process.cwd();
  console.log(`compose-cat: cwd=${cwd}, version=${PACKAGE_VERSION}`);

  // Setup CLI
  let program = new Command();

  const mainProgram = program
    .name('compose-cat')
    .description('ComposeCat: pass-through wrapper for Docker/Podman Compose with env and helpers')
    .version(PACKAGE_VERSION);

  setupCommand(mainProgram, async (composeArgs: string[], options) => {
    const extracted = prepare(composeArgs, options);
    if (!extracted) return;
    const { composeBin, args, mergedEnv, hooks } = extracted;

    // Run pre-hooks
    let code = await runHooks('pre', undefined, mergedEnv);
    if (code !== 0) return process.exit((process.exitCode = code));
    for (const h of hooks) {
      code = await runHooks('pre', h, mergedEnv);
      if (code !== 0) return process.exit((process.exitCode = code));
    }

    code = await runCompose(composeBin, args, {
      ...process.env,
      // ...mergedEnv,
    });

    for (const h of hooks) {
      const postCode = await runHooks('post', h, mergedEnv);
      if (postCode !== 0) return process.exit((process.exitCode = postCode));
    }
    // Run post-hooks regardless of compose result
    const postCode = await runHooks('post', undefined, mergedEnv);
    process.exitCode = postCode !== 0 ? postCode : code;
  });

  const cmpClean = program
    .command('cmp-clean')
    .description('Stop services, remove containers, and remove volumes');
  setupCommand(cmpClean, async (composeArgs: string[], options) => {
    const extracted = prepare(composeArgs, options);
    if (!extracted) return;
    const { composeBin, args, mergedEnv, hooks } = extracted;

    let code = await runHooks('pre', undefined, mergedEnv);
    if (code !== 0) return process.exit((process.exitCode = code));
    for (const h of hooks) {
      code = await runHooks('pre', h, mergedEnv);
      if (code !== 0) return process.exit((process.exitCode = code));
    }

    // rm -fsv
    code = await runCompose(composeBin, [...(args || []), 'rm', '-fsv'], {
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

    // post hooks
    for (const h of hooks) {
      const postCode = await runHooks('post', h, mergedEnv);
      if (postCode !== 0) return process.exit((process.exitCode = postCode));
    }
    const postCode = await runHooks('post', undefined, mergedEnv);
    if (postCode !== 0) return process.exit((process.exitCode = postCode));

    process.exit(0);
  });

  const cmpCleanILocal = program
    .command('cmp-clean-i-local')
    .description('Like cmp-clean and also removes images for services without a custom tag');

  setupCommand(cmpCleanILocal, async (composeArgs: string[], options) => {
    const extracted = prepare(composeArgs, options);
    if (!extracted) return;
    const { composeBin, args, mergedEnv, hooks } = extracted;

    let code = await runHooks('pre', undefined, mergedEnv);
    if (code !== 0) return process.exit((process.exitCode = code));
    for (const h of hooks) {
      code = await runHooks('pre', h, mergedEnv);
      if (code !== 0) return process.exit((process.exitCode = code));
    }

    // rm -fsv
    code = await runCompose(composeBin, [...(args || []), 'rm', '-fsv'], {
      ...process.env,
      // ...mergedEnv,
    });
    if (code !== 0) return process.exit((process.exitCode = code));

    // down --rmi local --volumes
    if (code !== 0) return process.exit((process.exitCode = code));
    code = await runCompose(composeBin, [...(args || []), 'down', '--rmi', 'local', '--volumes'], {
      ...process.env,
      // ...mergedEnv,
    });
    if (code !== 0) return process.exit((process.exitCode = code));

    // post hooks
    for (const h of hooks) {
      const postCode = await runHooks('post', h, mergedEnv);
      if (postCode !== 0) return process.exit((process.exitCode = postCode));
    }

    const postCode = await runHooks('post', undefined, mergedEnv);
    if (postCode !== 0) return process.exit((process.exitCode = postCode));

    process.exit(0);
  });

  const cmpCleanIAll = program
    .command('cmp-clean-i-all')
    .description('Like cmp-clean and also removes all images referenced by the services');

  setupCommand(cmpCleanIAll, async (composeArgs: string[], options) => {
    const extracted = prepare(composeArgs, options);
    if (!extracted) return;
    const { composeBin, args, mergedEnv, hooks } = extracted;

    // pre hooks
    let code = await runHooks('pre', undefined, mergedEnv);
    if (code !== 0) return process.exit((process.exitCode = code));
    for (const h of hooks) {
      code = await runHooks('pre', h, mergedEnv);
      if (code !== 0) return process.exit((process.exitCode = code));
    }

    // rm -fsv
    code = await runCompose(composeBin, [...(args || []), 'rm', '-fsv'], {
      ...process.env,
      // ...mergedEnv,
    });
    if (code !== 0) return process.exit((process.exitCode = code));

    // down --rmi all --volumes
    if (code !== 0) return process.exit((process.exitCode = code));
    code = await runCompose(composeBin, [...(args || []), 'down', '--rmi', 'all', '--volumes'], {
      ...process.env,
      // ...mergedEnv,
    });
    if (code !== 0) return process.exit((process.exitCode = code));

    // post hooks
    for (const h of hooks) {
      const postCode = await runHooks('post', h, mergedEnv);
      if (postCode !== 0) return process.exit((process.exitCode = postCode));
    }
    const postCode = await runHooks('post', undefined, mergedEnv);
    if (postCode !== 0) return process.exit((process.exitCode = postCode));

    process.exit(0);
  });

  await program.parseAsync(process.argv);
}

// Run
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
