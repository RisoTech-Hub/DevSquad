# Implementation Plan: GitHub Projects Integration

## Overview
Adopt a partial integration strategy where GitHub Projects v2 acts as the source of truth for task definition, queue priority, and macro-level status (Phases, Agent Status). The local filesystem (`session/`) will continue to handle micro-level execution data (turn logs, raw agent outputs) to avoid hitting GitHub API rate limits and keep the UI clean.

## Data Model

### Entities
- **Project**: 1 GitHub Project V2 Board per repository (a repository can have many).
- **Task**: Standard GitHub Issue.
- **Task Brief**: Stored as the Markdown body of the GitHub Issue.

### Custom Fields (GitHub Project V2)
| Field Name | Type | Allowed Values / Description |
| :--- | :--- | :--- |
| `Epic` | Single-select | User-defined epics (e.g., "Authentication", "UI Refactor") |
| `Phase` | Single-select | `Listening`, `Planning`, `Delegating`, `Waiting`, `Reporting`, `Offline` |
| `Agent Status` | Single-select | `Standby`, `Working`, `Done`, `Error` |
| `Devsquad ID` | Text | Internal task ID (e.g., `T002`) to link the GH Issue to local `session/output/` files |

### Storage
Local filesystem keeps micro logs (turn files, raw output) avoiding API rate limits.

## Architecture

The integration is organized around 4 service layers (bottom-up):

### Layer 1 — GitHubService
- Handles authentication using the `gh` CLI.
- Runs `gh auth status` → `gh auth login` → `gh auth token`.
- Injects the runtime token directly into `@octokit/graphql`.
- No token is stored in config or `~/.devsquad/projects.json`.
- Provides the base GraphQL client wrapper and executes raw queries/mutations.

### Layer 2 — RepoManager
- Manages repository detection, validation, and creation.
- Uses shell commands (`gh repo view`, `gh repo create`) and GraphQL `GetRepoDetails`.
- Executes Step 1 of the `project init` wizard.

### Layer 3 — ProjectManager
- Handles GitHub Projects V2 CRUD operations and custom field setup.
- Executes Step 2 of the `project init` wizard (project linking and creation).
- Caches the `githubProjectId` and custom field Node IDs in `~/.devsquad/projects.json`.

### Layer 4 — TaskManager
- Manages tasks (Issues) and their representation on the Project board.
- Translates task briefs into GitHub Issues.
- Handles asynchronous status syncing (e.g., updating Phase and Agent Status).

## Implementation Phases

### Phase 1 — GitHubService (auth + base client)
- **Files to create**: `src/infra/github/GitHubService.ts`
- **Methods/Responsibilities**:
  - `checkAuth()`
  - `login()`
  - `getGraphqlClient()`
- **Deliverable**: A base service that successfully authenticates with GitHub via `gh` CLI, handling the auth check/login flow, and injecting the token into a GraphQL client.
- **GraphQL operations**: Base client execution wrapper (no specific operations yet).

### Phase 2 — RepoManager (repo detect/create + wizard Step 1)
- **Files to create**: `src/application/github/RepoManager.ts`
- **Methods/Responsibilities**:
  - `detectRepo()` (from `git remote get-url origin`)
  - `checkRepoExists()`
  - `createRepo()`
  - `runStep1Wizard()`
- **Deliverable**: Implements wizard Step 1. Auto-detects `owner/repo` from git origin. Prompts user: `GitHub repository? [auto-detected: owner/repo]` (confirm or override, `--repo` flag to bypass). Checks if repo exists via `gh repo view owner/repo`. If not found, prompts: `Repository not found. Create it? [Y/n]`. If yes, calls `gh repo create` (public/private). If no, aborts to `--local-only` mode.
- **GraphQL operations**:
  - `GetRepoDetails` (plus `gh repo create` via shell)

### Phase 3 — ProjectManager (project wizard Step 2 + CRUD)
- **Files to create**: `src/application/github/ProjectManager.ts`
- **Methods/Responsibilities**:
  - `getLinkedAndUnlinkedProjects()`
  - `createProjectV2()`
  - `addCustomFields()`
  - `updateProjectLink()`
  - `runStep2Wizard()`
- **Deliverable**: Implements wizard Step 2. Queries projects linked to the repo (pre-checked ✅) and empty projects with no linked repo (unchecked). Renders a unified `inquirer.js` checkbox list. On confirm, diffs initial vs final: if unchecked → `UpdateProjectV2` set `linkedRepo = null`; if checked → `UpdateProjectV2` set `linkedRepo = current repo`; unchanged → no API call. Option 'c' creates a new project: prompts for name (default: repo name), calls `CreateProjectV2`, calls `AddProjectV2Field` for all 4 custom fields, and links it via `UpdateProjectV2`. Caches `githubProjectId` + custom field Node IDs in `~/.devsquad/projects.json`.
- **GraphQL operations**:
  - `GetProjectV2Details`
  - `CreateProjectV2`
  - `AddProjectV2Field`
  - `UpdateProjectV2`

### Phase 4 — TaskManager (task brief as Issue + status sync)
- **Files to create**: `src/application/github/TaskManager.ts`
- **Methods/Responsibilities**:
  - `createTaskIssue()`
  - `addIssueToProject()`
  - `syncTaskStatus()`
- **Deliverable**: Links task creation to GitHub. `devsquad task brief` creates an Issue with the brief body, adds it to the Project, and outputs the URL. `devsquad project update` asynchronously syncs `Phase` and `Agent Status` via GraphQL (fail-open).
- **GraphQL operations**:
  - `CreateIssue`
  - `AddProjectV2ItemById`
  - `UpdateProjectV2ItemFieldValue`

## CLI Changes

### `devsquad project init`
- **Before**: Creates Slack channel, tmux session, `.gitignore`, saves project config.
- **After**: Runs a two-step wizard — (1) detects or creates the GitHub repo (RepoManager), (2) links an existing or creates a new GitHub Project V2 (ProjectManager) — and caches the Project Node ID and Custom Field Node IDs.
- **New Flags**:
  - `--repo <owner/repo>` (Optional: override auto-detected repository)
  - `--github-project-number <number>` (Optional: skip interactive selection and link a specific project board)
  - `--local-only` (Optional: skip GitHub integration entirely)

### `devsquad task brief`
- **Before**: Scaffolds a markdown task brief and writes to stdout or local file.
- **After**: Scaffolds the brief, creates a standard Issue via GitHub API, adds it to the GH Project, and outputs the Issue URL.
- **New Flags**:
  - `--title <title>` (Required for Issue title)
  - `--epic <epic-name>` (Optional)
  - `--local-only` (Optional: bypass GitHub API and just write local file)

### `devsquad project update`
- **Before**: Updates local project state and posts to Slack.
- **After**: Updates local state, posts to Slack, AND executes a GraphQL mutation to sync the active task's `Phase` and `Agent Status` to the GitHub Project board.
- **New Flags**:
  - `--issue-id <node-id>` (To specify the Project Item for field updates).

## Risks & Mitigations

| Risk | Impact | Mitigation |
| :--- | :--- | :--- |
| **API Rate Limiting** | GitHub blocks the orchestrator (5000 req/hr limit). | Only sync macro states (Phase/Agent Status). Retain micro logs (per-turn streams) on local filesystem only. |
| **Network Instability** | Failing updates crash the orchestrator daemon. | Implement robust retry mechanisms (using the `cockatiel` library). If GH update fails after retries, log locally and skip (fail-open). |
| **Schema Drift** | Users rename custom fields (e.g., "Done" to "Complete") on GH UI. | Fetch and cache Field/Option IDs dynamically during `project init`. Warn the user gracefully if expected fields are missing. |
| **Latency / Race Conditions** | Slack and GitHub get out of sync. | Treat Slack as the immediate notification layer; treat GitHub as an eventually consistent dashboard. Fire GH updates asynchronously. |
| **Repo Creation Failure** | `gh repo create` fails due to missing permissions or org policy restrictions. | Catch the error, surface a clear message to the user, and fall back to `--local-only` mode. Document that org repos require the user to have the `repo` scope and appropriate org membership. |
| **Empty Project Linking Permissions** | Calling `UpdateProjectV2` to link an empty project to a repo fails for org-owned projects. | Requires org-level `write` permission on the project. Detect the error (403/insufficient scope), surface a clear message, and offer the user the option to create a new project instead. |
