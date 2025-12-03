+# compose-cat test harness

- +This folder contains a minimal Compose project that exercises the CLI from the workspace root
  +(the package is consumed via `file:..`). Use it to experiment with profiles, cleanup helpers, and
  +hook behavior without touching your real projects.
- +## Prerequisites
- +1. Install dependencies once:
-
- ```bash

  ```
- cd test
- npm install
- ```

  ```
- +2. Ensure you have Docker or Podman available (the root CLI will auto-detect the first working
- Compose binary).
- +## Available scripts
- +| Script | Description |
  +| ------ | ----------- |
  +| `npm run test -- <compose args>` | Runs `tsx ../src/index.ts` with your passthrough compose args. |
  +| `npm run up` | Brings up the stack with the `debug` profile (`compose-cat --profile=debug up -d`). |
  +| `npm run down` | Runs `compose-cat --profile=debug down` to stop containers. |
  +| `npm run clean` | Invokes `cmp-clean` with the `debug` profile to remove containers, volumes, and the store dir. |
  +| `npm run helptest` | Invokes the globally installed `compose-cat --help` for quick sanity checks. |
- +All scripts assume you stay inside the `test/` directory so relative paths resolve correctly.
- +## Sample workflow
- +`bash
+npm run up
+# ... interact with the stack ...
+npm run down
+npm run clean   # optional deep cleanup
+`
- +Feel free to duplicate this directory and tweak `.env`/profiles to model different environments while
  +keeping the root CLI behavior consistent.
