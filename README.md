# Compose Plus

Compose Plus is a small CLI that generates and runs Docker/Podman Compose commands from your terminal.

Use it like your usual compose command — just start with `compose-plus` instead of `docker compose`, `podman compose`, `docker-compose`, or `podman-compose`.

Highlights:

- Compose binary auto-detection with sensible defaults: `docker compose`, `podman compose`, `docker-compose`, `podman-compose`. You can override or reorder candidates.
- Profile-aware dotenv loading with support for local-only overrides via `.env.local`. When profiles are provided, Compose Plus loads: `.env`, `.env.local`, `.env.<PROFILE>`, `.env.<PROFILE>.local`.
- Project naming via `-p/--project-name` or `CMP_PROJECT_NAME`. Use different project names per profile if needed.
- Standardized data directories via environment variables: `CMP_DATA_BASE_DIR`, `CMP_INJECT_DIR`, `CMP_STORE_DIR`.
- Built-in cleanup commands: `cmp-clean`, `cmp-clean-i-local`, and `cmp-clean-i-all`.

## Quick Start

Install globally with npm:

```sh
npm install -g compose-plus
```

Or run without installing globally using npx:

```sh
npx compose-plus <COMPOSE_COMMAND> [OPTIONS]
```

Or install locally as a devDependency to use inside your project:

```sh
npm install --save-dev compose-plus
```

Examples:

Bring services up:

```sh
compose-plus up -d
```

Stop and remove services:

```sh
compose-plus down
```

## CLI Options

- `--cmp-bin <value...>`: Provide compose binary candidates in priority order.
  - Example: `--cmp-bin "podman compose" --cmp-bin "docker compose"`.
- `--cmp-prefix <value>`: Set the environment variable prefix (default: `CMP_`).
  - Also configurable via `COMPOSE_PLUS_PREFIX`.
- `--cmp-dotenv-prefix <value>`: Set the dotenv file prefix to detect (default: `.env`).
  - Also configurable via `COMPOSE_PLUS_DOTENV_PREFIX`.
- `-p, --project-name <value>`: Compose project name (overrides `CMP_PROJECT_NAME`).
- `--profile <value...>`: Profiles to use (comma-separated or repeat the flag), e.g. `--profile dev` or `--profile dev,test`.

## Commands

- `cmp-clean`: Convenience cleanup. Removes containers and networks/volumes, then clears `${CMP_STORE_DIR}` on the host.
  - `${CMP_DETECTED_COMPOSE_BIN} rm -fsv`
  - `${CMP_DETECTED_COMPOSE_BIN} down --volumes`
  - `rm -rf ${CMP_STORE_DIR}`

- `cmp-clean-i-local`: Like `cmp-clean`, and also removes images referenced by services that don’t have a custom tag.
  - `${CMP_DETECTED_COMPOSE_BIN} rm -fsv`
  - `${CMP_DETECTED_COMPOSE_BIN} down --rmi local --volumes`
  - `rm -rf ${CMP_STORE_DIR}`

- `cmp-clean-i-all`: Like `cmp-clean`, and also removes all images referenced by the services.
  - `${CMP_DETECTED_COMPOSE_BIN} rm -fsv`
  - `${CMP_DETECTED_COMPOSE_BIN} down --rmi all --volumes`
  - `rm -rf ${CMP_STORE_DIR}`

## How It Works

1. Read CLI options (including profiles, project name, prefix overrides).
2. Determine the environment variable prefix from `--cmp-prefix` or `COMPOSE_PLUS_PREFIX` (default: `CMP_`).
3. Determine the dotenv prefix from `--cmp-dotenv-prefix` or `COMPOSE_PLUS_DOTENV_PREFIX` (default: `.env`).
4. Load dotenv files: `.env`, `.env.local`, and for each profile: `.env.<PROFILE>`, `.env.<PROFILE>.local`.
5. Detect the compose binary from `CMP_COMPOSE_BIN` (if set) or probe defaults; you can override order with `--cmp-bin`.
6. Build the compose command: add `--env-file` flags, `--profile` flags, and `-p/--project-name` when provided.
7. Execute the compose command and exit with its status code.

## Special Flow for Cleanup Commands

The cleanup commands follow the general flow, but expand to multiple compose commands executed in sequence (see “Commands” above for exact arguments), followed by removing `${CMP_STORE_DIR}` on the host.

## Environment Variables

You can set these environment variables to control detection and defaults.

### `COMPOSE_PLUS_PREFIX`

- Sets the prefix for all Compose Plus–related environment variables.
- Default: `CMP_`
- Example: `COMPOSE_PLUS_PREFIX=MyPrefix_` yields variables like `MyPrefix_COMPOSE_BIN` instead of `CMP_COMPOSE_BIN`.

### `COMPOSE_PLUS_DOTENV_PREFIX`

- Sets the dotenv file prefix used for detection.
- Default: `.env`

## Compose Plus Environment Variables

All listed variables use the active prefix (default `CMP_`).

### `CMP_COMPOSE_BIN`

- Comma-separated list of compose binaries to probe, in order.
- If unset, Compose Plus probes in this order: `docker compose`, `podman compose`, `docker-compose`, `podman-compose`.
- Examples:
  - `CMP_COMPOSE_BIN=docker compose`
  - `CMP_COMPOSE_BIN=podman compose`
  - `CMP_COMPOSE_BIN=podman compose,docker compose`

### `CMP_DETECTED_COMPOSE_BIN`

- Set by Compose Plus to the compose binary that was selected at runtime.

### `CMP_PROJECT_NAME`

- If `-p/--project-name` is provided, this variable is ignored.
- Otherwise, if set, it is passed as `-p, --project-name ${CMP_PROJECT_NAME}` to compose.
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

The following files are used if present:

- Base files:
  - `.env`
  - `.env.local`

- Profile files (each `<PROFILE>` comes from `--profile`):
  - `.env.<PROFILE>`
  - `.env.<PROFILE>.local`

The dotenv file prefix is configurable via `--cmp-dotenv-prefix` or `COMPOSE_PLUS_DOTENV_PREFIX`.

## Notes

- Hooks are not implemented in this version.
- <del>Use `--` to force pass-through of all following arguments if needed, e.g. `compose-plus -- up -d --build`.</del>
