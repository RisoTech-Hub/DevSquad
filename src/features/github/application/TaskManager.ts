import { GitHubService } from '../infra/GitHubService';
import { GHFieldIds } from './ProjectManager';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TaskIssueInput {
  title: string;
  body: string;
  repoOwner: string;
  repoName: string;
  labels?: string[];
}

export interface TaskIssueResult {
  issueId: string;
  issueNumber: number;
  issueUrl: string;
}

export interface TaskStatusUpdate {
  projectId: string;
  itemId: string;
  fieldIds: GHFieldIds;
  phase?: string;
  agentStatus?: string;
  devsquadId?: string;
}

// ─── GraphQL Operations ───────────────────────────────────────────────────────

const GET_REPO_ID = `
  query GetRepoId($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) { id }
  }
`;

const CREATE_ISSUE = `
  mutation CreateIssue($repoId: ID!, $title: String!, $body: String!) {
    createIssue(input: { repositoryId: $repoId, title: $title, body: $body }) {
      issue { id number url }
    }
  }
`;

const ADD_PROJECT_V2_ITEM_BY_ID = `
  mutation AddProjectV2ItemById($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
      item { id }
    }
  }
`;

const GET_PROJECT_V2_FIELD_OPTIONS = `
  query GetProjectV2FieldOptions($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        fields(first: 20) {
          nodes {
            ... on ProjectV2SingleSelectField {
              id name
              options { id name }
            }
            ... on ProjectV2Field {
              id name
            }
          }
        }
      }
    }
  }
`;

const UPDATE_PROJECT_V2_ITEM_FIELD_VALUE = `
  mutation UpdateProjectV2ItemFieldValue($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: $value
    }) {
      projectV2Item { id }
    }
  }
`;

// ─── GraphQL Response Types ───────────────────────────────────────────────────

interface GetRepoIdResponse {
  repository: { id: string };
}

interface CreateIssueResponse {
  createIssue: {
    issue: { id: string; number: number; url: string };
  };
}

interface AddProjectV2ItemByIdResponse {
  addProjectV2ItemById: {
    item: { id: string };
  };
}

interface ProjectV2FieldOption {
  id: string;
  name: string;
}

interface ProjectV2SingleSelectField {
  id: string;
  name: string;
  options: ProjectV2FieldOption[];
}

interface ProjectV2Field {
  id: string;
  name: string;
}

type ProjectV2FieldNode = ProjectV2SingleSelectField | ProjectV2Field | Record<string, never>;

interface GetProjectV2FieldOptionsResponse {
  node: {
    fields: {
      nodes: ProjectV2FieldNode[];
    };
  } | null;
}

// ─── TaskManager ─────────────────────────────────────────────────────────────

export class TaskManager {
  constructor(private github: GitHubService) {}

  async createTaskIssue(input: TaskIssueInput): Promise<TaskIssueResult> {
    const graphql = await this.github.getGraphqlClient();

    // Get the repository node ID first
    const repoResult = await graphql<GetRepoIdResponse>(GET_REPO_ID, {
      owner: input.repoOwner,
      name: input.repoName,
    });
    const repoId = repoResult.repository.id;

    // Create the issue
    const issueResult = await graphql<CreateIssueResponse>(CREATE_ISSUE, {
      repoId,
      title: input.title,
      body: input.body,
    });

    const issue = issueResult.createIssue.issue;
    return {
      issueId: issue.id,
      issueNumber: issue.number,
      issueUrl: issue.url,
    };
  }

  async addIssueToProject(projectId: string, issueId: string): Promise<string> {
    const graphql = await this.github.getGraphqlClient();

    const result = await graphql<AddProjectV2ItemByIdResponse>(ADD_PROJECT_V2_ITEM_BY_ID, {
      projectId,
      contentId: issueId,
    });

    return result.addProjectV2ItemById.item.id;
  }

  async syncTaskStatus(update: TaskStatusUpdate): Promise<void> {
    const { projectId, itemId, fieldIds, phase, agentStatus, devsquadId } = update;

    // Nothing to update
    if (!phase && !agentStatus && !devsquadId) return;

    const graphql = await this.github.getGraphqlClient();

    // Fetch field options once for single_select lookups
    let fieldOptionsMap: Map<string, ProjectV2FieldOption[]> | null = null;

    const needsSingleSelect = phase !== undefined || agentStatus !== undefined;
    if (needsSingleSelect) {
      try {
        const optionsResult = await graphql<GetProjectV2FieldOptionsResponse>(
          GET_PROJECT_V2_FIELD_OPTIONS,
          { projectId },
        );

        fieldOptionsMap = new Map<string, ProjectV2FieldOption[]>();

        if (optionsResult.node) {
          for (const node of optionsResult.node.fields.nodes) {
            const n = node as Partial<ProjectV2SingleSelectField>;
            if (n.id && n.options) {
              fieldOptionsMap.set(n.id, n.options);
            }
          }
        }
      } catch (err) {
        console.error('[TaskManager] Failed to fetch field options:', err);
        // Cannot do single_select updates without options — skip them
        fieldOptionsMap = null;
      }
    }

    const findOptionId = (fieldId: string, valueName: string): string | undefined => {
      if (!fieldOptionsMap) return undefined;
      const options = fieldOptionsMap.get(fieldId);
      if (!options) return undefined;
      return options.find(o => o.name.toLowerCase() === valueName.toLowerCase())?.id;
    };

    // Update Phase
    if (phase !== undefined) {
      const optionId = findOptionId(fieldIds.phaseFieldId, phase);
      if (optionId) {
        try {
          await graphql(UPDATE_PROJECT_V2_ITEM_FIELD_VALUE, {
            projectId,
            itemId,
            fieldId: fieldIds.phaseFieldId,
            value: { singleSelectOptionId: optionId },
          });
        } catch (err) {
          console.error('[TaskManager] Failed to update Phase field:', err);
        }
      } else {
        console.error(`[TaskManager] Could not find option "${phase}" for Phase field`);
      }
    }

    // Update Agent Status
    if (agentStatus !== undefined) {
      const optionId = findOptionId(fieldIds.agentStatusFieldId, agentStatus);
      if (optionId) {
        try {
          await graphql(UPDATE_PROJECT_V2_ITEM_FIELD_VALUE, {
            projectId,
            itemId,
            fieldId: fieldIds.agentStatusFieldId,
            value: { singleSelectOptionId: optionId },
          });
        } catch (err) {
          console.error('[TaskManager] Failed to update Agent Status field:', err);
        }
      } else {
        console.error(`[TaskManager] Could not find option "${agentStatus}" for Agent Status field`);
      }
    }

    // Update Devsquad ID (text field)
    if (devsquadId !== undefined) {
      try {
        await graphql(UPDATE_PROJECT_V2_ITEM_FIELD_VALUE, {
          projectId,
          itemId,
          fieldId: fieldIds.devsquadIdFieldId,
          value: { text: devsquadId },
        });
      } catch (err) {
        console.error('[TaskManager] Failed to update Devsquad ID field:', err);
      }
    }
  }
}
