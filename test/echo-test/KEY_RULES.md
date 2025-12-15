## Global Rules

- `COMPOSE_ENV_FILES` must be predefined before run docker compose

## `--env-file` and `COMPOSE_ENV_FILES` vs `env_file` in compose.yaml

- `--env-file` and `COMPOSE_ENV_FILES` are used for interpolation values
- `env_file` in compose.yaml is used for container runtime env


## `/` (rootDir)

### .env loading rules

```sh
docker compose up
```

- `COMPOSE_FILE`: works
- `COMPOSE_PROJECT_NAME`: works
- `COMPOSE_ENV_FILES`: not works
- `--env-file`: not works

### default behavior:
- load .env
- load demo/.env
- load demo/api/.env

### .env values are parent first:

```sh
COMPOSE_FILE=demo/compose.yaml
COMPOSE_PROJECT_NAME=demoxx
SOURCE=FROM_ROOT_DOTENV
ONLY_IN_ROOT=ROOT_ONLY
```

## `/demo`

```sh
cd demo
docker compose up
```

- `COMPOSE_FILE`: works
- `COMPOSE_PROJECT_NAME`: works
- `COMPOSE_ENV_FILES`: not works
- `--env-file`: works

### default loaded .env files:
- load demo/.env
- load demo/api/.env

### .env values are parent first:

```sh
COMPOSE_PROJECT_NAME=project_demo
SOURCE=FROM_DEMO_DOTENV
ONLY_IN_ROOT=
ONLY_IN_PROJECT=PROJECT_ONLY
```

### log

```sh
cd demo
docker compose up

>>>> Executing external compose provider "/usr/local/bin/docker-compose". Please see podman-compose(1) for how to disable this message. <<<<

WARN[0000] The "ONLY_IN_ROOT" variable is not set. Defaulting to a blank string. 
WARN[0000] The "CHILD_MARK" variable is not set. Defaulting to a blank string. 
WARN[0000] The "ONLY_IN_ROOT" variable is not set. Defaulting to a blank string. 
WARN[0000] The "CHILD_MARK" variable is not set. Defaulting to a blank string. 
WARN[0000] The "ONLY_IN_ROOT" variable is not set. Defaulting to a blank string. 
WARN[0000] The "ONLY_IN_ROOT" variable is not set. Defaulting to a blank string. 
[+] Running 5/0
 ✔ Network project_demo_default           Created                                                                                                      0.0s 
 ✔ Container project_demo-child-write-1   Created                                                                                                      0.0s 
 ✔ Container project_demo-child-print-1   Created                                                                                                      0.0s 
 ✔ Container project_demo-parent-write-1  Created                                                                                                      0.0s 
 ✔ Container project_demo-parent-print-1  Created                                                                                                      0.0s 
Attaching to child-print-1, child-write-1, parent-print-1, parent-write-1
child-write-1   | [child-write] writing to /out/from-child.txt
child-print-1   | [child-print] PWD=/
child-print-1   | [child-print] SOURCE=FROM_DEMO_DOTENV
child-print-1   | [child-print] ONLY_IN_ROOT=
child-print-1   | [child-print] ONLY_IN_PROJECT=PROJECT_ONLY
child-print-1   | [child-print] CHILD_MARK=CHILD_ENV
child-print-1   | [child-print] cat /data/child.txt
child-print-1   | CHILD MOUNT OK
child-print-1   | This file is at: demo/api/mount/child.txt
child-print-1   | If you see this inside child-print container, included compose resolved ./mount relative to demo/api/
child-print-1   | HOSTNAME=280599de8e9a
child-print-1   | SHLVL=1
child-print-1   | HOME=/root
child-print-1   | PAGER=less
child-print-1   | container=podman
child-print-1   | LC_COLLATE=C
child-print-1   | PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
child-print-1   | LANG=C.UTF-8
child-print-1   | PWD=/
child-print-1   | CHARSET=UTF-8
child-write-1   | [child-write] done
parent-print-1  | [parent-print] PWD=/
parent-print-1  | [parent-print] SOURCE=FROM_DEMO_DOTENV
parent-print-1  | [parent-print] ONLY_IN_ROOT=
parent-print-1  | [parent-print] ONLY_IN_PROJECT=PROJECT_ONLY
parent-print-1  | [parent-print] CHILD_MARK=
parent-print-1  | [parent-print] cat /data/parent.txt
parent-print-1  | PARENT MOUNT OK
parent-print-1  | This file is at: demo/mount/parent.txt
parent-print-1  | If you see this inside parent-print container, parent compose resolved ./mount relative to demo/
parent-print-1  | HOSTNAME=f63bf7a55a05
parent-print-1  | SHLVL=1
parent-print-1  | HOME=/root
parent-print-1  | PAGER=less
parent-print-1  | container=podman
parent-print-1  | LC_COLLATE=C
parent-print-1  | PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
parent-print-1  | LANG=C.UTF-8
parent-print-1  | PWD=/
parent-print-1  | CHARSET=UTF-8
parent-write-1  | [parent-write] writing to /out/from-parent.txt
parent-write-1  | [parent-write] done
parent-print-1 exited with code 0
child-write-1 exited with code 0
parent-write-1 exited with code 0
child-print-1 exited with code 0
```

```sh
cd demo
docker compose --env-file=.env --env-file=.env.test up
>>>> Executing external compose provider "/usr/local/bin/docker-compose". Please see podman-compose(1) for how to disable this message. <<<<

WARN[0000] The "ONLY_IN_ROOT" variable is not set. Defaulting to a blank string. 
WARN[0000] The "CHILD_MARK" variable is not set. Defaulting to a blank string. 
WARN[0000] The "ONLY_IN_ROOT" variable is not set. Defaulting to a blank string. 
WARN[0000] The "CHILD_MARK" variable is not set. Defaulting to a blank string. 
WARN[0000] The "ONLY_IN_ROOT" variable is not set. Defaulting to a blank string. 
WARN[0000] The "ONLY_IN_ROOT" variable is not set. Defaulting to a blank string. 
[+] Running 5/0
 ✔ Network project_demo_test_default           Created                                                                                                 0.0s 
 ✔ Container project_demo_test-child-print-1   Created                                                                                                 0.0s 
 ✔ Container project_demo_test-child-write-1   Created                                                                                                 0.0s 
 ✔ Container project_demo_test-parent-write-1  Created                                                                                                 0.0s 
 ✔ Container project_demo_test-parent-print-1  Created                                                                                                 0.0s 
Attaching to child-print-1, child-write-1, parent-print-1, parent-write-1
child-write-1   | [child-write] writing to /out/from-child.txt
child-print-1   | [child-print] PWD=/
child-print-1   | [child-print] SOURCE=FROM_DEMO_DOTENV_TEST
child-print-1   | [child-print] ONLY_IN_ROOT=
child-print-1   | [child-print] ONLY_IN_PROJECT=PROJECT_ONLY
child-print-1   | [child-print] CHILD_MARK=CHILD_ENV
child-print-1   | [child-print] cat /data/child.txt
child-print-1   | CHILD MOUNT OK
child-print-1   | This file is at: demo/api/mount/child.txt
child-print-1   | If you see this inside child-print container, included compose resolved ./mount relative to demo/api/
child-print-1   | HOSTNAME=580ddf72d4f6
child-print-1   | SHLVL=1
child-print-1   | HOME=/root
child-print-1   | PAGER=less
child-print-1   | container=podman
child-print-1   | LC_COLLATE=C
child-print-1   | PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
child-print-1   | LANG=C.UTF-8
child-print-1   | PWD=/
child-print-1   | CHARSET=UTF-8
child-write-1   | [child-write] done
parent-print-1  | [parent-print] PWD=/
parent-print-1  | [parent-print] SOURCE=FROM_DEMO_DOTENV_TEST
parent-print-1  | [parent-print] ONLY_IN_ROOT=
parent-print-1  | [parent-print] ONLY_IN_PROJECT=PROJECT_ONLY
parent-print-1  | [parent-print] CHILD_MARK=
parent-print-1  | [parent-print] cat /data/parent.txt
parent-print-1  | PARENT MOUNT OK
parent-print-1  | This file is at: demo/mount/parent.txt
parent-print-1  | If you see this inside parent-print container, parent compose resolved ./mount relative to demo/
parent-print-1  | HOSTNAME=79b961cb371a
parent-print-1  | SHLVL=1
parent-print-1  | HOME=/root
parent-print-1  | PAGER=less
parent-print-1  | container=podman
parent-print-1  | LC_COLLATE=C
parent-print-1  | PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
parent-print-1  | LANG=C.UTF-8
parent-print-1  | PWD=/
parent-print-1  | CHARSET=UTF-8
parent-write-1  | [parent-write] writing to /out/from-parent.txt
parent-write-1  | [parent-write] done
parent-print-1 exited with code 0
child-print-1 exited with code 0
parent-write-1 exited with code 0
child-write-1 exited with code 0
```