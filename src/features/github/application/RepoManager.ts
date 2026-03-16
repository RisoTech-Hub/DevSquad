import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import prompts from 'prompts';
import { GitHubService } from '../infra/GitHubService';

const exec = promisify(execCb);

export interface RepoInfo {
  owner: string;
  repo: string;
  fullName: string; // "owner/repo"
}

export type RepoWizardResult =
  | { mode: 'github'; repo: RepoInfo }
  | { mode: 'local-only' };

const GET_REPO_DETAILS = `
  query GetRepoDetails($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      id
      name
      owner { login }
      url
    }
  }
`;

function parseRepoUrl(url: string): RepoInfo | null {
  // SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) {
    const owner = sshMatch[1];
    const repo = sshMatch[2];
    return { owner, repo, fullName: `${owner}/${repo}` };
  }

  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    const owner = httpsMatch[1];
    const repo = httpsMatch[2];
    return { owner, repo, fullName: `${owner}/${repo}` };
  }

  return null;
}

function parseFullName(fullName: string): RepoInfo | null {
  const parts = fullName.trim().split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [owner, repo] = parts;
  return { owner, repo, fullName: `${owner}/${repo}` };
}

export class RepoManager {
  constructor(private github: GitHubService) {}

  async detectRepo(): Promise<RepoInfo | null> {
    try {
      const { stdout } = await exec('git remote get-url origin');
      const url = stdout.trim();
      return parseRepoUrl(url);
    } catch {
      return null;
    }
  }

  async checkRepoExists(repo: RepoInfo): Promise<boolean> {
    try {
      await exec(`gh repo view ${repo.fullName}`);
      return true;
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT' || (error.message && error.message.includes('not found'))) {
        throw new Error('GitHub CLI (gh) is not installed. Install from https://cli.github.com');
      }
      // 404 / "Could not resolve" → repo doesn't exist
      return false;
    }
  }

  async createRepo(repo: RepoInfo): Promise<void> {
    const { visibility } = await prompts({
      type: 'select',
      name: 'visibility',
      message: 'Visibility?',
      choices: [
        { title: 'public', value: 'public' },
        { title: 'private', value: 'private' },
      ],
      initial: 1,
    });

    if (!visibility) {
      throw new Error('Repo creation cancelled.');
    }

    try {
      await exec(`gh repo create ${repo.fullName} --${visibility}`);
    } catch (err: unknown) {
      const error = err as Error;
      throw new Error(`Failed to create repository ${repo.fullName}: ${error.message}`);
    }
  }

  async runStep1Wizard(repoOverride?: string): Promise<RepoWizardResult> {
    let repoInfo: RepoInfo | null = null;

    if (repoOverride) {
      repoInfo = parseFullName(repoOverride);
      if (!repoInfo) {
        throw new Error(`Invalid repository format: "${repoOverride}". Expected "owner/repo".`);
      }
    } else {
      const detected = await this.detectRepo();

      const { repoInput } = await prompts({
        type: 'text',
        name: 'repoInput',
        message: 'GitHub repository?',
        initial: detected?.fullName ?? '',
        hint: detected ? `auto-detected: ${detected.fullName}` : 'owner/repo or leave blank to skip',
      });

      if (repoInput === undefined) {
        // User cancelled (Ctrl+C)
        return { mode: 'local-only' };
      }

      const trimmed = (repoInput as string).trim();
      if (!trimmed) {
        return { mode: 'local-only' };
      }

      repoInfo = parseFullName(trimmed);
      if (!repoInfo) {
        throw new Error(`Invalid repository format: "${trimmed}". Expected "owner/repo".`);
      }
    }

    const exists = await this.checkRepoExists(repoInfo);

    if (exists) {
      // Optionally fetch repo metadata via GraphQL
      try {
        const graphql = await this.github.getGraphqlClient();
        await graphql(GET_REPO_DETAILS, { owner: repoInfo.owner, repo: repoInfo.repo });
      } catch {
        // Non-fatal: GraphQL metadata fetch is best-effort
      }
      return { mode: 'github', repo: repoInfo };
    }

    // Repo not found — offer to create it
    const { createIt } = await prompts({
      type: 'confirm',
      name: 'createIt',
      message: `Repository ${repoInfo.fullName} not found. Create it?`,
      initial: true,
    });

    if (!createIt) {
      return { mode: 'local-only' };
    }

    await this.createRepo(repoInfo);
    return { mode: 'github', repo: repoInfo };
  }
}
