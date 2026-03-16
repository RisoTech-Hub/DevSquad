# Feature-Centric Architecture Design for devsquad CLI

## 1. Executive Summary
This document proposes a restructuring of the `src/` directory from a purely horizontal layered architecture to a **Vertical Slice / Feature-Centric Architecture**. This aligns with Clean Architecture principles while grouping cohesive business logic together.

Each feature becomes a self-contained module containing its own `domain`, `application`, `infra`, and `commands` layers as needed. Shared infrastructure (e.g., Redis, Tmux, Docker) and cross-cutting utilities (e.g., Configuration, Paths) are extracted into a `shared/` directory.

## 2. Identified Features
1. **`agent`**: Agent registry and management.
2. **`config`**: CLI configuration management.
3. **`daemon`**: Background daemon management, Slack listeners, and message processors.
4. **`doctor`**: System and workspace health checks.
5. **`github`**: GitHub integrations, repo management, and tasks.
6. **`project`**: Project context and status management.
7. **`slack`**: Slack bot integrations, clients, and sockets.

## 3. Shared & Cross-Cutting Concerns
The `shared/` directory encapsulates technical capabilities that do not belong to a single business feature:
- **Infrastructure**: Redis caching, Tmux session management, Docker services.
- **Utilities**: Global configurations (`config.ts`), filesystem paths (`paths.ts`), and preflight environment checks (`preflight.ts`).

## 4. Proposed Directory Tree
```text
src/
├── cli.ts                       # Main entry point (registers commands from features)
├── shared/                      # Cross-cutting concerns & shared infra
│   ├── domain/
│   │   ├── redis/
│   │   └── tmux/
│   ├── infra/
│   │   ├── docker/
│   │   ├── redis/
│   │   └── tmux/
│   ├── utils/                   # paths, config, preflight
│   └── index.ts                 # Shared module public exports
└── features/
    ├── agent/
    │   ├── application/
    │   ├── commands/
    │   └── index.ts
    ├── config/
    │   ├── commands/
    │   └── index.ts
    ├── daemon/
    │   ├── application/
    │   ├── commands/
    │   ├── infra/               # LaunchDaemonManager
    │   ├── utils/
    │   └── index.ts
    ├── doctor/
    │   ├── application/         # DoctorService, checks/
    │   ├── commands/
    │   ├── domain/              # types.ts
    │   └── index.ts
    ├── github/
    │   ├── application/
    │   ├── commands/            # task.ts
    │   ├── infra/
    │   └── index.ts
    ├── project/
    │   ├── application/
    │   ├── commands/
    │   ├── utils/
    │   └── index.ts
    └── slack/
        ├── application/
        ├── commands/
        ├── domain/
        ├── infra/
        └── index.ts
```

## 5. File Mapping (Old Path → New Path)

| Old Path | New Path |
|----------|----------|
| `src/cli.ts` | `src/cli.ts` |
| **Commands** | |
| `src/commands/agent.ts` | `src/features/agent/commands/agent.ts` |
| `src/commands/config.ts` | `src/features/config/commands/config.ts` |
| `src/commands/daemon.ts` | `src/features/daemon/commands/daemon.ts` |
| `src/commands/run-listener.ts` | `src/features/daemon/commands/run-listener.ts` |
| `src/commands/run-processor.ts`| `src/features/daemon/commands/run-processor.ts`|
| `src/commands/doctor.ts` | `src/features/doctor/commands/doctor.ts` |
| `src/commands/project.ts` | `src/features/project/commands/project.ts` |
| `src/commands/slack.ts` | `src/features/slack/commands/slack.ts` |
| `src/commands/task.ts` | `src/features/github/commands/task.ts` |
| **Agent Feature** | |
| `src/application/agent/AgentRegistryService.ts` | `src/features/agent/application/AgentRegistryService.ts` |
| **Daemon Feature** | |
| `src/application/daemon/DaemonStatusService.ts` | `src/features/daemon/application/DaemonStatusService.ts` |
| `src/application/daemon/MessageProcessorDaemon.ts` | `src/features/daemon/application/MessageProcessorDaemon.ts` |
| `src/application/daemon/SlackListenerDaemon.ts` | `src/features/daemon/application/SlackListenerDaemon.ts` |
| `src/application/daemon/TeamStatusService.ts` | `src/features/daemon/application/TeamStatusService.ts` |
| `src/infra/launchdaemon/LaunchDaemonManager.ts` | `src/features/daemon/infra/LaunchDaemonManager.ts` |
| `src/utils/daemon.ts` | `src/features/daemon/utils/daemon.ts` |
| **Doctor Feature** | |
| `src/application/doctor/DoctorService.ts` | `src/features/doctor/application/DoctorService.ts` |
| `src/application/doctor/DoctorFormatter.ts` | `src/features/doctor/application/DoctorFormatter.ts` |
| `src/application/doctor/types.ts` | `src/features/doctor/domain/types.ts` |
| `src/application/doctor/checks/*` | `src/features/doctor/application/checks/*` |
| **GitHub Feature** | |
| `src/application/github/ProjectManager.ts` | `src/features/github/application/ProjectManager.ts` |
| `src/application/github/RepoManager.ts` | `src/features/github/application/RepoManager.ts` |
| `src/application/github/TaskManager.ts` | `src/features/github/application/TaskManager.ts` |
| `src/infra/github/GitHubService.ts` | `src/features/github/infra/GitHubService.ts` |
| **Project Feature** | |
| `src/application/project/ProjectService.ts` | `src/features/project/application/ProjectService.ts` |
| `src/application/project/ProjectStatusService.ts` | `src/features/project/application/ProjectStatusService.ts` |
| `src/utils/project.ts` | `src/features/project/utils/project.ts` |
| **Slack Feature** | |
| `src/application/slack/SlackService.ts` | `src/features/slack/application/SlackService.ts` |
| `src/domain/slack/ISlackClient.ts` | `src/features/slack/domain/ISlackClient.ts` |
| `src/domain/slack/ISlackSocket.ts` | `src/features/slack/domain/ISlackSocket.ts` |
| `src/infra/slack/SlackBoltClient.ts` | `src/features/slack/infra/SlackBoltClient.ts` |
| `src/infra/slack/SlackBoltSocket.ts` | `src/features/slack/infra/SlackBoltSocket.ts` |
| `src/infra/slack/SlackSocketModeAdapter.ts`| `src/features/slack/infra/SlackSocketModeAdapter.ts`|
| **Shared Infra & Utils** | |
| `src/domain/redis/IRedisService.ts` | `src/shared/domain/redis/IRedisService.ts` |
| `src/infra/redis/RedisService.ts` | `src/shared/infra/redis/RedisService.ts` |
| `src/domain/tmux/ITmuxService.ts` | `src/shared/domain/tmux/ITmuxService.ts` |
| `src/infra/tmux/TmuxService.ts` | `src/shared/infra/tmux/TmuxService.ts` |
| `src/infra/docker/DockerService.ts` | `src/shared/infra/docker/DockerService.ts` |
| `src/utils/config.ts` | `src/shared/utils/config.ts` |
| `src/utils/paths.ts` | `src/shared/utils/paths.ts` |
| `src/utils/preflight.ts` | `src/shared/utils/preflight.ts` |
*(Note: Redundant `index.ts` files inside deep directories are removed or consolidated at the feature root).*

## 6. Barrel Export (`index.ts`) Conventions
Each feature directory MUST have an `index.ts` at its root (`src/features/<feature_name>/index.ts`).
- **Exported:** Commands (to be registered by `cli.ts`), Domain Interfaces, and public Application Services required by other features.
- **Hidden:** Infrastructure adapters, internal checks, and specific utility functions. These should not be exported from the barrel file, encapsulating the feature's internal implementation.

## 7. Cross-Feature Import Dependencies
- **Rule:** A feature may import from `src/shared/` freely. However, when importing from another feature, it **MUST ONLY** import from that feature's root barrel file (`index.ts`).
  - ✅ `import { SlackService } from '../slack';`
  - ❌ `import { SlackService } from '../slack/application/SlackService';`
- **Known Dependencies:**
  - `daemon` heavily depends on `slack` (e.g., `SlackListenerDaemon` needs the Slack domain interfaces and application services).
  - `project` and `github` may interact if project context requires fetching GitHub data.
  - `doctor` imports services across various features to run health checks.

## 8. Migration Strategy
1. **Create Base Structure**: Generate the `src/features/` and `src/shared/` directories.
2. **Move Shared Modules**: Move `redis`, `tmux`, `docker`, and `utils` to `shared/` and update their relative imports.
3. **Migrate Features**: Iteratively move each feature (`slack`, `github`, `daemon`, etc.) into their respective folders.
4. **Update CLI**: Adjust `src/cli.ts` to register commands from `src/features/*/commands/`.
5. **Fix Imports**: Run a TypeScript build (`tsc --noEmit`) to catch and fix all broken relative imports.
6. **Update Tests**: Realign `tests/` directory to mirror the new `src/features/` structure.
