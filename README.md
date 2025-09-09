# Compose Plus

Compose Plus is a small CLI that generates and runs Docker/Podman Compose commands from your terminal.

Use it like your usual compose command — just start with `compose-plus` instead of `docker compose`, `podman compose`, `docker-compose`, or `podman-compose`.

Highlights:

- Compose binary auto-detection with sensible defaults: `docker compose`, `podman compose`, `docker-compose`, `podman-compose`. You can override or reorder candidates via `--cmp-bin` or `CMP_COMPOSE_BIN`.
- Profile-aware dotenv loading with support for local-only overrides via `.env.local`. When profiles are provided, Compose Plus loads: `.env`, `.env.local`, `.env.<PROFILE>`, `.env.<PROFILE>.local`.
- Project naming via `-p/--project-name` or `CMP_PROJECT_NAME`. Use different project names per profile if needed.
- Standardized data directories via environment variables: `CMP_DATA_BASE_DIR`, `CMP_INJECT_DIR`, `CMP_STORE_DIR`.
- Built-in cleanup commands: `cmp-clean`, `cmp-clean-i-local`, and `cmp-clean-i-all`.
- Pluggable pre/post hooks with per-command, per-platform, and per-binary variants.

## Quick Start

Install globally with npm:

```sh
npm install -g compose-plus
```

Or install locally as a devDependency to use inside your project:

```sh
npm install --save-dev compose-plus
```

Examples:

Usage:

```sh
compose-plus <COMPOSE_COMMAND> [OPTIONS]
```

Run using npx:

```sh
npx compose-plus <COMPOSE_COMMAND> [OPTIONS]
```

Bring services up:

```sh
compose-plus up -d
```

Stop and remove services:

```sh
compose-plus down
```

## CLI Options

- `--cmp-hook <value...>`: Hook names to run (pre and post). Example: `--cmp-hook up` runs matching `cmp.pre.up.*` and `cmp.post.up.*` hooks.
- `--cmp-bin <value...>`: Provide compose binary candidates in priority order.
  - Example: `--cmp-bin "podman compose" --cmp-bin "docker compose"`.
- `--cmp-prefix <value>`: Set the environment variable prefix (default: `CMP_`).
  - Also configurable via `COMPOSE_PLUS_PREFIX`.
- `--cmp-dotenv-prefix <value>`: Set the dotenv file prefix to detect (default: `.env`).
  - Also configurable via `COMPOSE_PLUS_DOTENV_PREFIX`.
- `-p, --project-name <value>`: Compose project name (overrides `CMP_PROJECT_NAME`).
- `--profile <value...>`: Profiles to use (comma-separated or repeat the flag), e.g., `--profile dev` or `--profile dev,test`.

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

1. Read CLI options (including profiles, project name, and prefix overrides).
2. Determine the environment variable prefix from `--cmp-prefix` or `COMPOSE_PLUS_PREFIX` (default: `CMP_`).
3. Determine the dotenv prefix from `--cmp-dotenv-prefix` or `COMPOSE_PLUS_DOTENV_PREFIX` (default: `.env`).
4. Load dotenv files: `.env`, `.env.local`, and for each profile: `.env.<PROFILE>`, `.env.<PROFILE>.local`.
5. Detect the compose binary from `CMP_COMPOSE_BIN` (if set) or probe defaults; you can override the order with `--cmp-bin`.
6. Build the compose command: add `--env-file` flags, `--profile` flags, and `-p/--project-name` when provided.
7. Run matching pre-hooks.
8. Execute the compose command and capture its exit code.
9. Run matching post-hooks and exit with the final status code.

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

## Hooks

You can integrate hook scripts that run before and after the compose command. Compose Plus searches for hook files in the current working directory and supports per-command, per-platform, and per-binary variants.

File name patterns (where `stage` is `pre` or `post`):

- Base: `cmp.<stage>.<EXT>`
- Platform: `cmp.<stage>.<PLATFORM>.<EXT>`
- Binary: `cmp.<stage>.+<BINARY>.<EXT>`
- Platform + Binary: `cmp.<stage>.<PLATFORM>+<BINARY>.<EXT>`
- Hook name: `cmp.<stage>.<HOOK>.<EXT>`
- Hook name + Platform/Binary: `cmp.<stage>.<HOOK>.<PLATFORM>+<BINARY>.<EXT>`

Where:

- `HOOK`: Hook name provided via the `--cmp-hook` argument (e.g., `up`).
- `PLATFORM`: Target platform. Use `win32` or `windows` for Windows, `darwin` or `macos` for macOS, and `linux` for Linux.
- `BINARY`: Executable used to run the script (e.g., `bash`, `sh`, `pwsh`, `node`). If omitted, the file itself is executed. Ensure it is executable or includes a shebang.
- `EXT`: File extension (e.g., `sh`, `ps1`, `js`).

Examples when running with `--cmp-hook=up` (if present, these may execute):

- `cmp.pre.sh`
- `cmp.pre.linux.sh`
- `cmp.pre.darwin.sh`
- `cmp.pre.win32.ps1`
- `cmp.pre.win32+pwsh.ps1`
- `cmp.pre.+node.js`
- `cmp.pre.up.sh`
- `cmp.pre.up.linux.sh`
- `cmp.pre.up.darwin.sh`
- `cmp.pre.up.win32.ps1`
- `cmp.pre.up.win32+pwsh.ps1`
- `cmp.pre.up.+node.js`
- `cmp.post.sh`
- `cmp.post.linux.sh`
- `cmp.post.darwin.sh`
- `cmp.post.win32.ps1`
- `cmp.post.win32+pwsh.ps1`
- `cmp.post.+node.js`
- `cmp.post.up.sh`
- `cmp.post.up.linux.sh`
- `cmp.post.up.darwin.sh`
- `cmp.post.up.win32.ps1`
- `cmp.post.up.win32+pwsh.ps1`
- `cmp.post.up.+node.js`

Environment variables exposed to hooks:

- `CMP_HOOK_EVENT`: The stage (`pre` or `post`).
- `CMP_HOOK_COMMAND`: The hook name when `--cmp-hook` is provided; otherwise empty.
- `CMP_HOOK_PLATFORM`: The matched platform string, if any.
- `CMP_HOOK_BINARY`: The matched binary string, if any.
- `CMP_HOOK_FILE`: The absolute path of the hook file being executed.

## Notes

- You don’t need `--` to pass through arguments; the CLI forwards unknown options and positional arguments to the underlying compose command.
