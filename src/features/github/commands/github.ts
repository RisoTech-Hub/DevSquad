import { Command } from 'commander';
import { GitHubService, RepoManager, ProjectManager, TaskManager } from '../index';
import type { TaskIssueInput } from '../application/TaskManager';

const GET_USER_ORG_ID = `
  query GetUserOrOrgId($login: String!) {
    user(login: $login) {
      id
    }
    organization(login: $login) {
      id
    }
  }
`;

interface UserOrOrgIdResponse {
  user: { id: string } | null;
  organization: { id: string } | null;
}

async function getOwnerId(login: string, github: GitHubService): Promise<string> {
  const graphql = await github.getGraphqlClient();
  const result = await graphql<UserOrOrgIdResponse>(GET_USER_ORG_ID, { login });

  if (result.user) {
    return result.user.id;
  }
  if (result.organization) {
    return result.organization.id;
  }
  throw new Error(`Could not find user or organization: ${login}`);
}

export function githubCommand(program: Command): void {
  const github = program
    .command('github')
    .description('GitHub CLI commands for authentication, repositories, projects, and issues');

  // 1. devsquad github auth
  github
    .command('auth')
    .description('Check or initialize GitHub CLI authentication')
    .action(async () => {
      try {
        const gh = new GitHubService();
        await gh.ensureAuth();
        console.log('✓ Authenticated with GitHub');
      } catch (err) {
        const error = err as Error;
        console.error('Error:', error.message);
        process.exit(1);
      }
    });

  // 2. devsquad github repo init
  github
    .command('repo-init')
    .description('Detect the current git repository or interactively create a new one on GitHub')
    .option('--repo <owner/repo>', 'Target repository (owner/repo)')
    .action(async (options) => {
      try {
        const gh = new GitHubService();
        await gh.ensureAuth();

        const repoManager = new RepoManager(gh);
        const result = await repoManager.runStep1Wizard(options.repo);

        if (result.mode === 'local-only') {
          console.log('No GitHub repository configured.');
        } else {
          console.log(`✓ Repository configured: ${result.repo.fullName}`);
        }
      } catch (err) {
        const error = err as Error;
        console.error('Error:', error.message);
        process.exit(1);
      }
    });

  // 3. devsquad github project create
  github
    .command('project-create')
    .description('Create a GitHub Project V2 with devsquad custom fields')
    .requiredOption('--title <string>', 'Title of the new GitHub project')
    .requiredOption('--owner <string>', 'GitHub user login or organization name that will own the project')
    .action(async (options) => {
      try {
        const gh = new GitHubService();
        await gh.ensureAuth();

        const ownerId = await getOwnerId(options.owner, gh);
        const projectManager = new ProjectManager(gh);

        const project = await projectManager.createProjectV2(options.title, ownerId);
        await projectManager.addCustomFields(project.id);

        console.log(`✓ Created GitHub Project: ${project.url}`);
      } catch (err) {
        const error = err as Error;
        console.error('Error:', error.message);
        process.exit(1);
      }
    });

  // 4. devsquad github issue create
  github
    .command('issue-create')
    .description('Create a new GitHub issue in a specified repository')
    .requiredOption('--title <string>', 'The issue title')
    .requiredOption('--body <string>', 'The issue body text')
    .requiredOption('--repo <owner/repo>', 'The target repository (owner/repo)')
    .action(async (options) => {
      try {
        const gh = new GitHubService();
        await gh.ensureAuth();

        const repoParts = options.repo.split('/');
        if (repoParts.length !== 2) {
          throw new Error(`Invalid repository format: "${options.repo}". Expected "owner/repo".`);
        }

        const [repoOwner, repoName] = repoParts;

        const input: TaskIssueInput = {
          title: options.title,
          body: options.body,
          repoOwner,
          repoName,
        };

        const taskManager = new TaskManager(gh);
        const result = await taskManager.createTaskIssue(input);

        console.log(`✓ GitHub Issue created: ${result.issueUrl}`);
      } catch (err) {
        const error = err as Error;
        console.error('Error:', error.message);
        process.exit(1);
      }
    });
}
