# Compose Plus

Compose Plus is a small CLI that generates and runs Docker/Podman Compose commands from your terminal.

It passes all arguments through to the configured compose binary (for example, `docker compose`, `podman compose`, `docker-compose`, or `podman-compose`) and respects your environment-driven configuration.

## Quick Start

Install globally with npm:

```sh
npm install -g compose-plus
```

Or run without installing globally using npx:

```sh
npx compose-plus <COMPOSE_COMMAND> [OPTIONS]
```

Examples:

```sh
# Bring services up with build
compose-plus up -d --build

# Use a specific binary
compose-plus -b "podman compose" up -d
```

## Arguments

- `-b, --bin`:
  - Override the detected compose binary.
  - Accepts multiple occurrences to set priority, e.g. `--bin "podman compose" --bin "docker compose"`.
  - Examples: `docker compose`, `podman compose`, `/PATH/TO/BINARY`.

- `--version`: Print Compose Plus version.

## Commands

- `cmp-clean`: Convenience cleanup. Removes containers and volumes, and deletes files under `${CMP_STORE_DIR}` that are bind-mounted from the host.
  - Stop and remove containers: `${CMP_DETECTED_COMPOSE_BIN} rm -fsv`
  - Remove containers and networks: `${CMP_DETECTED_COMPOSE_BIN} down --volumes`
  - Remove bind-mounted data on host: `rm -rf ${CMP_STORE_DIR}`

- `cmp-clean-i`: Like `cmp-clean`, and also removes local images referenced by the project.
  - Stop and remove containers: `${CMP_DETECTED_COMPOSE_BIN} rm -fsv`
  - Remove containers, networks, and local images: `${CMP_DETECTED_COMPOSE_BIN} down --rmi local --volumes`
  - Remove bind-mounted data on host: `rm -rf ${CMP_STORE_DIR}`

## How It Works

1. Detect profiles from `CMP_PROFILE`, then optionally override via `--profile`.
2. Set the environment variable prefix from `COMPOSE_PLUS_PREFIX` (default: `CMP`).
3. Load dotenv files: `.env`, `.env.local`, `.env.<PROFILE>`, `.env.<PROFILE>.local`.
4. Detect the compose binary from `CMP_COMPOSE_BIN`, then optionally override via `--bin`.
5. Generate the compose command with computed options and flags.
6. Execute pre-hook scripts if present.
7. Execute the compose command.
8. Execute post-hook scripts if present.
9. Exit with the same exit code as the compose command.

## Special Flow for `cmp-clean` and `cmp-clean-i`

Same as the general flow, except step 5 expands to a sequence of commands executed in order:

1. `${CMP_DETECTED_COMPOSE_BIN} rm -fsv`
2. `${CMP_DETECTED_COMPOSE_BIN} down --volumes` (or `${CMP_DETECTED_COMPOSE_BIN} down --rmi local --volumes` for `cmp-clean-i`)
3. `rm -rf ${CMP_STORE_DIR}`

## Environment Variables

All environment variables default to the `CMP` prefix. You can change this prefix with `COMPOSE_PLUS_PREFIX`.

### `COMPOSE_PLUS_PREFIX`

- Sets the prefix for all Compose Plus-related environment variables.
- Default: `CMP`
- Example: `COMPOSE_PLUS_PREFIX=MyPrefix_` makes variables like `MyPrefix_PROFILE` instead of `CMP_PROFILE`.

### `CMP_DOTENV_PREFIX`

- Changes the dotenv file prefix used for detection.
- Default: `.env`

### `CMP_PROFILE`

- Comma-separated list of profiles; used to load profile-specific dotenv files.
- If no profile is specified, only `.env` and `.env.local` are considered.
- Example: `CMP_PROFILE=development,test` loads:
  - `.env`, `.env.local`, `.env.development`, `.env.development.local`, `.env.test`, `.env.test.local` (if present)

### `CMP_COMPOSE_BIN`

The environment variable to specify the compose binary to use the `CMP_DETECTED_COMPOSE_BIN` is derived from this variable.

- Comma-separated list of compose binaries to probe, in order.
- If unset, Compose Plus probes in this order: `docker compose`, `podman compose`, `docker-compose`, `podman-compose`.
- Examples:
  - `CMP_COMPOSE_BIN=docker compose`
  - `CMP_COMPOSE_BIN=podman compose`
  - `CMP_COMPOSE_BIN=podman compose,docker compose`

### `CMP_PROJECT_NAME`

- If set, passed as `-p, --project-name ${CMP_PROJECT_NAME}` to the compose command.
- Useful for selecting per-profile project names.

### `CMP_BASE_DIR`

- Base directory for project-relative operations.
- Default: `.`

### `CMP_DATA_BASE_DIR`

- Root directory under which Compose Plus ensures data directories exist.
- Default: `${CMP_BASE_DIR}/container-data`

### `CMP_INJECT_DIR`

- Directory intended for files injected into containers (referenced from `compose.yml`).
- Automatically created if missing.
- Default: `${CMP_DATA_BASE_DIR}/inject`

### `CMP_STORE_DIR`

- Directory intended for files produced by containers (referenced from `compose.yml`).
- Automatically created if missing.
- Default: `${CMP_DATA_BASE_DIR}/store`

## Dotenv Auto-Detection

Compose Plus discovers dotenv files at startup and adds them to the compose command as `--env-file` flags.

The following files will be used if present:

- Base files:
  - `.env` → `${CMP_DETECTED_COMPOSE_BIN} --env-file .env`
  - `.env.local` → `${CMP_DETECTED_COMPOSE_BIN} --env-file .env --env-file .env.local`

- Profile files (`<PROFILE>` comes from `CMP_PROFILE`):
  - `.env.<PROFILE>` → `${CMP_DETECTED_COMPOSE_BIN} --env-file .env.<PROFILE>`
  - `.env.<PROFILE>.local` (if present) → `${CMP_DETECTED_COMPOSE_BIN} --env-file .env.<PROFILE> --env-file .env.<PROFILE>.local`

The prefix used for detection is configurable via `CMP_DOTENV_PREFIX` (default `.env`).

## Hooks

You can integrate hook scripts that run before and after the compose command. Compose Plus discovers scripts per event and platform:

- `cmp.${COMMAND}.pre.${BINARY}.${EXTENSION}`
- `cmp.${COMMAND}.${PLATFORM}.pre.${BINARY}.${EXTENSION}`
- `cmp.${COMMAND}.post.${BINARY}.${EXTENSION}`
- `cmp.${COMMAND}.${PLATFORM}.post.${BINARY}.${EXTENSION}`

Where:

- `COMMAND`: compose command name, e.g. `up`, `down`, `rm`.
- `BINARY`: script runner, e.g. `sh`, `zsh`, `bash`, `pwsh`, `powershell`, `powershell.exe`, `node`, `python`, `cmd`, `cmd.exe`.
- `PLATFORM`: Node.js platform identifier, e.g. `win32`, `linux`, `darwin`.

Compose Plus detects an executable for the chosen `BINARY` in your environment and executes the script with it.

Examples for `up`:

- Windows (`win32`):
  - `cmp.up.pre.${BINARY}.${EXTENSION}`
  - `cmp.up.win32.pre.${BINARY}.${EXTENSION}`
  - `cmp.up.post.${BINARY}.${EXTENSION}`
  - `cmp.up.win32.post.${BINARY}.${EXTENSION}`

- Linux (`linux`):
  - `cmp.up.pre.${BINARY}.${EXTENSION}`
  - `cmp.up.linux.pre.${BINARY}.${EXTENSION}`
  - `cmp.up.post.${BINARY}.${EXTENSION}`
  - `cmp.up.linux.post.${BINARY}.${EXTENSION}`

- macOS (`darwin`):
  - `cmp.up.pre.${BINARY}.${EXTENSION}`
  - `cmp.up.darwin.pre.${BINARY}.${EXTENSION}`
  - `cmp.up.post.${BINARY}.${EXTENSION}`
  - `cmp.up.darwin.post.${BINARY}.${EXTENSION}`
