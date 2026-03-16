import { GitHubService } from './infra/GitHubService';

export { ProjectManager } from './application/ProjectManager';
export type { GHProject, GHFieldIds, ProjectWizardResult } from './application/ProjectManager';
export { RepoManager } from './application/RepoManager';
export type { RepoInfo, RepoWizardResult } from './application/RepoManager';
export { TaskManager } from './application/TaskManager';
export { taskCommand, runTaskBriefCommand } from './commands/task';

/** Creates a GitHubService instance without exposing the infra class directly. */
export function createGitHubService(): GitHubService {
  return new GitHubService();
}
