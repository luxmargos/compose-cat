# Docker Compose `include` / `.env` / bind mount rules (example project)

This repo is a minimal playground to understand how **Docker Compose / Podman Compose** behaves for:

- `include:` (Compose v2 feature)
- **relative path resolution** (especially bind mounts)
- `.env` loading and precedence (including the “two `.env` files” behavior)
- `--env-file` ordering

## Project layout

```
.
├── .env                       # PWD .env (loaded first when running from repo root)
└── demo/
    ├── compose.yaml           # parent compose (uses include)
    ├── .env                   # project-dir .env (may be loaded second)
    ├── mount/parent.txt
    ├── write/                 # parent-write writes here
    └── api/
        ├── compose.yaml       # included compose file (child sub-project)
        ├── .env               # child defaults for interpolation
        ├── .env.test          # alt child defaults
        ├── mount/child.txt
        └── write/             # child-write writes here
```

## Key rule 1: `include:` loads a *sub-project*

`demo/compose.yaml` includes `demo/api/compose.yaml`:

- The included file is parsed as **its own Compose project** and then merged into the parent model.
- **Local (parent) environment has precedence** over values coming from the included project’s `.env` / `env_file`.
  - Think of included `.env` as **defaults for interpolation**, not “hard overrides”.

### How to see it

Run from `demo/`:

```bash
podman compose up --abort-on-container-exit
```

You will see:

- `child-print` prints `SOURCE=FROM_DEMO_DOTENV` even though `demo/api/.env` defines `SOURCE=FROM_API_DOTENV`.
  - This demonstrates: **parent env overrides included defaults**.
- `CHILD_MARK` prints `CHILD_ENV`.
  - This demonstrates: if the parent doesn’t define a variable, the included defaults can still fill it.

## Key rule 2: relative paths inside an included file are resolved relative to *that file*

This is the most important “bind mount 기준 디렉토리” rule:

- In **parent** compose (`demo/compose.yaml`), `./mount/...` resolves relative to `demo/`.
- In **child** compose (`demo/api/compose.yaml`), `./mount/...` resolves relative to `demo/api/`.

### How to see it (read-only bind)

- `parent-print` bind-mounts:

  - host: `demo/mount/parent.txt`
  - container: `/data/parent.txt`

- `child-print` bind-mounts:

  - host: `demo/api/mount/child.txt`
  - container: `/data/child.txt`

Run:

```bash
podman compose up --abort-on-container-exit
```

Expected:

- `parent-print` prints the content of `demo/mount/parent.txt`
- `child-print` prints the content of `demo/api/mount/child.txt`

## Key rule 3: bind-mount + container writes are visible on the host

Two services write files into bind-mounted host directories:

- `parent-write` writes to `/out/from-parent.txt`
  - host path: `demo/write/from-parent.txt`

- `child-write` writes to `/out/from-child.txt`
  - host path: `demo/api/write/from-child.txt`

Run:

```bash
podman compose up --abort-on-container-exit
```

Then check on host:

```bash
ls -la demo/write
ls -la demo/api/write
cat demo/write/from-parent.txt
cat demo/api/write/from-child.txt
```

## Key rule 4: `.env` loading (PWD `.env` vs project-directory `.env`)

When you run Compose **without** `--env-file`:

- Compose loads `.env` from **your current working directory (PWD)**.
- If that `.env` sets `COMPOSE_FILE` so the actual project file lives elsewhere,
  Compose may then load a **second `.env`** from the resolved project directory.
  - The **second `.env` has lower precedence**.

### How this repo demonstrates it

Repo root `.env` contains:

- `COMPOSE_FILE=demo/compose.yaml`
- `SOURCE=FROM_ROOT_DOTENV`

Project `.env` at `demo/.env` contains:

- `SOURCE=FROM_DEMO_DOTENV`
- `ONLY_IN_PROJECT=PROJECT_ONLY`

#### Run from repo root (two `.env` effect)

Run from `./`:

```bash
podman compose up --abort-on-container-exit
```

Expected:

- `SOURCE` comes from root `.env` (higher precedence)
- `ONLY_IN_PROJECT` is still present (filled by project `.env`)

#### Run from `demo/` (single project `.env` effect)

Run from `demo/`:

```bash
podman compose up --abort-on-container-exit
```

Expected:

- `SOURCE=FROM_DEMO_DOTENV`
- `ONLY_IN_ROOT` is empty (because root `.env` is not involved)

## Key rule 5: `--env-file` ordering

If you pass `--env-file` explicitly, **Compose uses those files for interpolation values**, and the ordering matters.

Example patterns:

```bash
# later files typically override earlier ones
podman compose --env-file .env --env-file demo/.env.test up
podman compose --env-file demo/.env.test --env-file .env up
```

Use this to confirm which value wins for `SOURCE`.

## Notes

- This repo prints `env` inside containers (`parent-print`, `child-print`) to make it obvious which variables are available.
- `.env` vs `services.*.env_file` are different concepts:
  - `.env` / `--env-file` => **Compose interpolation time**
  - `services.<name>.env_file` => **container runtime env**
