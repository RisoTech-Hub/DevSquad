export { ProjectService } from './application/ProjectService';
export type { ProjectConfig } from './application/ProjectService';
export { ProjectStatusService } from './application/ProjectStatusService';
export { projectCommand } from './commands/project';
export {
  resolveProjectName,
  ensureGitignore,
  ensureGitRepo,
  ensureGitRemote,
  GITIGNORE_ENTRIES,
  startTmuxSession,
  generateSessionId,
} from './utils/project';
