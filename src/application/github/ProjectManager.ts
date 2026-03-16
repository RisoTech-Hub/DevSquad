import prompts from 'prompts';
import { GitHubService } from '../../infra/github/GitHubService';
import { RepoInfo } from './RepoManager';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GHProject {
  id: string;
  number: number;
  title: string;
  url: string;
  linkedRepos: string[];
}

export interface GHFieldIds {
  epicFieldId: string;
  phaseFieldId: string;
  agentStatusFieldId: string;
  devsquadIdFieldId: string;
}

export interface ProjectWizardResult {
  project: GHProject;
  fieldIds: GHFieldIds;
}

// ─── GraphQL Operations ───────────────────────────────────────────────────────

const GET_VIEWER_LOGIN = `
  query GetViewerLogin {
    viewer { id login }
  }
`;

const GET_USER_PROJECTS = `
  query GetUserProjects($login: String!) {
    user(login: $login) {
      projectsV2(first: 50) {
        nodes {
          id number title url
          repositories(first: 10) { nodes { nameWithOwner } }
        }
      }
    }
  }
`;

const GET_ORG_PROJECTS = `
  query GetOrgProjects($login: String!) {
    organization(login: $login) {
      projectsV2(first: 50) {
        nodes {
          id number title url
          repositories(first: 10) { nodes { nameWithOwner } }
        }
      }
    }
  }
`;

const GET_REPO_OWNER_TYPE = `
  query GetRepoOwnerType($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      owner { __typename id login }
    }
  }
`;

const GET_REPO_NODE_ID = `
  query GetRepoNodeId($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) { id }
  }
`;

const CREATE_PROJECT_V2 = `
  mutation CreateProjectV2($ownerId: ID!, $title: String!) {
    createProjectV2(input: { ownerId: $ownerId, title: $title }) {
      projectV2 { id number title url }
    }
  }
`;

const ADD_PROJECT_V2_SINGLE_SELECT_FIELD = `
  mutation AddProjectV2SingleSelectField($projectId: ID!, $name: String!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
    createProjectV2Field(input: {
      projectId: $projectId
      dataType: SINGLE_SELECT
      name: $name
      singleSelectOptions: $options
    }) {
      projectV2Field { ... on ProjectV2SingleSelectField { id name } }
    }
  }
`;

const ADD_PROJECT_V2_TEXT_FIELD = `
  mutation AddProjectV2TextField($projectId: ID!, $name: String!) {
    createProjectV2Field(input: { projectId: $projectId, dataType: TEXT, name: $name }) {
      projectV2Field { ... on ProjectV2Field { id name } }
    }
  }
`;

const LINK_PROJECT_V2_TO_REPOSITORY = `
  mutation LinkProjectV2ToRepository($projectId: ID!, $repositoryId: ID!) {
    linkProjectV2ToRepository(input: { projectId: $projectId, repositoryId: $repositoryId }) {
      repository { id }
    }
  }
`;

const UNLINK_PROJECT_V2_FROM_REPOSITORY = `
  mutation UnlinkProjectV2FromRepository($projectId: ID!, $repositoryId: ID!) {
    unlinkProjectV2FromRepository(input: { projectId: $projectId, repositoryId: $repositoryId }) {
      repository { id }
    }
  }
`;

const GET_PROJECT_V2_DETAILS = `
  query GetProjectV2Details($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        id title
        fields(first: 20) {
          nodes {
            ... on ProjectV2Field { id name }
            ... on ProjectV2SingleSelectField { id name }
          }
        }
      }
    }
  }
`;

// ─── GraphQL Response Types ───────────────────────────────────────────────────

interface ViewerLoginResponse {
  viewer: { id: string; login: string };
}

interface UserProjectsResponse {
  user: {
    projectsV2: {
      nodes: Array<{
        id: string;
        number: number;
        title: string;
        url: string;
        repositories: { nodes: Array<{ nameWithOwner: string }> };
      }>;
    };
  };
}

interface OrgProjectsResponse {
  organization: {
    projectsV2: {
      nodes: Array<{
        id: string;
        number: number;
        title: string;
        url: string;
        repositories: { nodes: Array<{ nameWithOwner: string }> };
      }>;
    };
  };
}

interface RepoOwnerTypeResponse {
  repository: {
    owner: { __typename: string; id: string; login: string };
  };
}

interface RepoNodeIdResponse {
  repository: { id: string };
}

interface CreateProjectV2Response {
  createProjectV2: {
    projectV2: { id: string; number: number; title: string; url: string };
  };
}

interface AddSingleSelectFieldResponse {
  createProjectV2Field: {
    projectV2Field: { id: string; name: string } | null;
  };
}

interface AddTextFieldResponse {
  createProjectV2Field: {
    projectV2Field: { id: string; name: string } | null;
  };
}

interface ProjectV2DetailsResponse {
  node: {
    id: string;
    title: string;
    fields: {
      nodes: Array<{ id: string; name: string } | Record<string, never>>;
    };
  } | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CREATE_NEW_VALUE = '__create__';

const PHASE_OPTIONS = [
  { name: 'Listening', description: 'Waiting for input', color: 'BLUE' },
  { name: 'Planning', description: 'Analyzing request', color: 'PURPLE' },
  { name: 'Delegating', description: 'Sending tasks to agents', color: 'YELLOW' },
  { name: 'Waiting', description: 'Waiting for agent responses', color: 'ORANGE' },
  { name: 'Reporting', description: 'Summarizing results', color: 'GREEN' },
  { name: 'Offline', description: 'Session inactive', color: 'GRAY' },
];

const AGENT_STATUS_OPTIONS = [
  { name: 'Standby', description: 'Idle', color: 'BLUE' },
  { name: 'Working', description: 'Processing task', color: 'YELLOW' },
  { name: 'Done', description: 'Task completed', color: 'GREEN' },
  { name: 'Error', description: 'Task failed', color: 'RED' },
];

// ─── ProjectManager ───────────────────────────────────────────────────────────

export class ProjectManager {
  constructor(private github: GitHubService) {}

  async getRepoOwner(repo: RepoInfo): Promise<{ type: 'User' | 'Organization'; id: string; login: string }> {
    const graphql = await this.github.getGraphqlClient();
    const result = await graphql<RepoOwnerTypeResponse>(GET_REPO_OWNER_TYPE, {
      owner: repo.owner,
      repo: repo.repo,
    });
    const owner = result.repository.owner;
    return {
      type: owner.__typename as 'User' | 'Organization',
      id: owner.id,
      login: owner.login,
    };
  }

  async getLinkedAndUnlinkedProjects(repo: RepoInfo): Promise<{
    linked: GHProject[];
    unlinked: GHProject[];
    owner: { type: 'User' | 'Organization'; id: string; login: string };
  }> {
    const graphql = await this.github.getGraphqlClient();

    const owner = await this.getRepoOwner(repo);

    let projectNodes: Array<{
      id: string; number: number; title: string; url: string;
      repositories: { nodes: Array<{ nameWithOwner: string }> };
    }>;

    if (owner.type === 'Organization') {
      const result = await graphql<OrgProjectsResponse>(GET_ORG_PROJECTS, { login: owner.login });
      projectNodes = result.organization.projectsV2.nodes;
    } else {
      const result = await graphql<UserProjectsResponse>(GET_USER_PROJECTS, { login: owner.login });
      projectNodes = result.user.projectsV2.nodes;
    }

    const linked: GHProject[] = [];
    const unlinked: GHProject[] = [];

    for (const node of projectNodes) {
      const linkedRepos = node.repositories.nodes.map(r => r.nameWithOwner);
      const project: GHProject = {
        id: node.id,
        number: node.number,
        title: node.title,
        url: node.url,
        linkedRepos,
      };

      if (linkedRepos.includes(repo.fullName)) {
        linked.push(project);
      } else {
        unlinked.push(project);
      }
    }

    return { linked, unlinked, owner };
  }

  async createProjectV2(title: string, ownerId: string): Promise<GHProject> {
    const graphql = await this.github.getGraphqlClient();

    const result = await graphql<CreateProjectV2Response>(CREATE_PROJECT_V2, {
      ownerId,
      title,
    });

    const p = result.createProjectV2.projectV2;
    return { id: p.id, number: p.number, title: p.title, url: p.url, linkedRepos: [] };
  }

  async addCustomFields(projectId: string): Promise<GHFieldIds> {
    const graphql = await this.github.getGraphqlClient();

    // Epic — text field (options are dynamic, added as epics are created)
    const epicResult = await graphql<AddTextFieldResponse>(
      ADD_PROJECT_V2_TEXT_FIELD,
      { projectId, name: 'Epic' },
    );
    const epicFieldId = epicResult.createProjectV2Field.projectV2Field?.id;
    if (!epicFieldId) throw new Error('Failed to create Epic field');

    // Phase — single_select
    const phaseResult = await graphql<AddSingleSelectFieldResponse>(
      ADD_PROJECT_V2_SINGLE_SELECT_FIELD,
      {
        projectId,
        name: 'Phase',
        options: PHASE_OPTIONS,
      },
    );
    const phaseFieldId = phaseResult.createProjectV2Field.projectV2Field?.id;
    if (!phaseFieldId) throw new Error('Failed to create Phase field');

    // Agent Status — single_select
    const agentResult = await graphql<AddSingleSelectFieldResponse>(
      ADD_PROJECT_V2_SINGLE_SELECT_FIELD,
      {
        projectId,
        name: 'Agent Status',
        options: AGENT_STATUS_OPTIONS,
      },
    );
    const agentStatusFieldId = agentResult.createProjectV2Field.projectV2Field?.id;
    if (!agentStatusFieldId) throw new Error('Failed to create Agent Status field');

    // Devsquad ID — text
    const idResult = await graphql<AddTextFieldResponse>(ADD_PROJECT_V2_TEXT_FIELD, {
      projectId,
      name: 'Devsquad ID',
    });
    const devsquadIdFieldId = idResult.createProjectV2Field.projectV2Field?.id;
    if (!devsquadIdFieldId) throw new Error('Failed to create Devsquad ID field');

    return { epicFieldId, phaseFieldId, agentStatusFieldId, devsquadIdFieldId };
  }

  async ensureCustomFields(
    projectId: string,
    existing: { epicFieldId?: string; phaseFieldId?: string; agentStatusFieldId?: string; devsquadIdFieldId?: string },
  ): Promise<GHFieldIds> {
    const graphql = await this.github.getGraphqlClient();

    // Fetch current fields to find any that already exist
    const detailsResult = await graphql<ProjectV2DetailsResponse>(GET_PROJECT_V2_DETAILS, {
      projectId,
    });
    const node = detailsResult.node;
    const currentFields = (node?.fields.nodes ?? []) as Array<{ id: string; name: string }>;
    const findExisting = (name: string): string | undefined =>
      currentFields.find(f => f.name === name)?.id;

    const epicFieldId = existing.epicFieldId ?? findExisting('Epic') ?? (
      await graphql<AddTextFieldResponse>(ADD_PROJECT_V2_TEXT_FIELD, { projectId, name: 'Epic' })
    ).createProjectV2Field.projectV2Field?.id;
    if (!epicFieldId) throw new Error('Failed to create Epic field');

    const phaseFieldId = existing.phaseFieldId ?? findExisting('Phase') ?? (
      await graphql<AddSingleSelectFieldResponse>(ADD_PROJECT_V2_SINGLE_SELECT_FIELD, {
        projectId, name: 'Phase', options: PHASE_OPTIONS,
      })
    ).createProjectV2Field.projectV2Field?.id;
    if (!phaseFieldId) throw new Error('Failed to create Phase field');

    const agentStatusFieldId = existing.agentStatusFieldId ?? findExisting('Agent Status') ?? (
      await graphql<AddSingleSelectFieldResponse>(ADD_PROJECT_V2_SINGLE_SELECT_FIELD, {
        projectId, name: 'Agent Status', options: AGENT_STATUS_OPTIONS,
      })
    ).createProjectV2Field.projectV2Field?.id;
    if (!agentStatusFieldId) throw new Error('Failed to create Agent Status field');

    const devsquadIdFieldId = existing.devsquadIdFieldId ?? findExisting('Devsquad ID') ?? (
      await graphql<AddTextFieldResponse>(ADD_PROJECT_V2_TEXT_FIELD, { projectId, name: 'Devsquad ID' })
    ).createProjectV2Field.projectV2Field?.id;
    if (!devsquadIdFieldId) throw new Error('Failed to create Devsquad ID field');

    return { epicFieldId, phaseFieldId, agentStatusFieldId, devsquadIdFieldId };
  }

  async updateProjectLink(
    projectId: string,
    repoId: string,
    action: 'link' | 'unlink',
  ): Promise<void> {
    const graphql = await this.github.getGraphqlClient();

    if (action === 'link') {
      process.stdout.write(`  Linking project to repository... `);
      await graphql(LINK_PROJECT_V2_TO_REPOSITORY, { projectId, repositoryId: repoId });
      console.log('✓');
    } else {
      await graphql(UNLINK_PROJECT_V2_FROM_REPOSITORY, { projectId, repositoryId: repoId });
    }
  }

  async runStep2Wizard(repo: RepoInfo): Promise<ProjectWizardResult> {
    const graphql = await this.github.getGraphqlClient();

    // Step 1: Fetch repo node ID
    const repoNodeResult = await graphql<RepoNodeIdResponse>(GET_REPO_NODE_ID, {
      owner: repo.owner,
      repo: repo.repo,
    });
    const repoId = repoNodeResult.repository.id;

    // Step 2: Fetch linked/unlinked projects (scoped to repo owner, not viewer)
    const { linked, unlinked, owner: repoOwner } = await this.getLinkedAndUnlinkedProjects(repo);
    const initiallyLinkedIds = new Set(linked.map(p => p.id));

    // Step 3: Show multiselect
    const hasExistingProjects = linked.length > 0 || unlinked.length > 0;
    const { selected } = await prompts({
      type: 'multiselect',
      name: 'selected',
      message: 'Select GitHub Projects to link with this repo',
      choices: [
        ...linked.map(p => ({ title: p.title, value: p.id, selected: true })),
        ...unlinked.map(p => ({
          title: `${p.title} (unlinked)`,
          value: p.id,
          selected: false,
        })),
        { title: '+ Create new project', value: CREATE_NEW_VALUE, selected: !hasExistingProjects },
      ],
    });

    if (!selected) {
      throw new Error('Project selection cancelled.');
    }

    const selectedIds: string[] = selected as string[];
    const wantsCreate = selectedIds.includes(CREATE_NEW_VALUE);
    const chosenIds = selectedIds.filter(id => id !== CREATE_NEW_VALUE);

    // Step 4: Diff and apply link/unlink
    const allProjects = new Map<string, GHProject>(
      [...linked, ...unlinked].map(p => [p.id, p]),
    );

    for (const id of chosenIds) {
      if (!initiallyLinkedIds.has(id)) {
        await this.updateProjectLink(id, repoId, 'link');
        const p = allProjects.get(id);
        if (p) p.linkedRepos = [...p.linkedRepos, repo.fullName];
      }
    }

    for (const id of initiallyLinkedIds) {
      if (!chosenIds.includes(id)) {
        await this.updateProjectLink(id, repoId, 'unlink');
      }
    }

    // Step 5: Handle "Create new project"
    let newProject: GHProject | undefined;
    // Track field IDs from creation to avoid re-fetching
    let createdFieldIds: GHFieldIds | undefined;
    if (wantsCreate) {
      const { newName } = await prompts({
        type: 'text',
        name: 'newName',
        message: 'New project name?',
        initial: repo.repo,
      });

      if (!newName) throw new Error('Project creation cancelled.');

      newProject = await this.createProjectV2(newName as string, repoOwner.id);
      createdFieldIds = await this.addCustomFields(newProject.id);
      await this.updateProjectLink(newProject.id, repoId, 'link');
      newProject.linkedRepos = [repo.fullName];
      allProjects.set(newProject.id, newProject);
      chosenIds.push(newProject.id);
    }

    if (chosenIds.length === 0) {
      throw new Error('No project selected. At least one project must be linked.');
    }

    // Step 6: Pick primary project
    let primaryId: string;
    if (chosenIds.length === 1) {
      primaryId = chosenIds[0];
    } else {
      const { primary } = await prompts({
        type: 'select',
        name: 'primary',
        message: 'Which project should devsquad use as primary?',
        choices: chosenIds.map(id => {
          const p = allProjects.get(id);
          return { title: p?.title ?? id, value: id };
        }),
      });

      if (!primary) throw new Error('Primary project selection cancelled.');
      primaryId = primary as string;
    }

    const primaryProject = allProjects.get(primaryId);
    if (!primaryProject) throw new Error(`Could not find project with id: ${primaryId}`);

    // Step 7: Resolve field IDs
    let fieldIds: GHFieldIds;

    if (createdFieldIds && newProject && primaryId === newProject.id) {
      // Newly created project — use field IDs from creation directly
      fieldIds = createdFieldIds;
    } else {
      // Existing project — ensure devsquad fields exist
      console.log('  Ensuring devsquad fields on project...');
      fieldIds = await this.ensureCustomFields(primaryId, {});
    }

    return { project: primaryProject, fieldIds };
  }
}
