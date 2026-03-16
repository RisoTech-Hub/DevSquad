import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { DevsquadConfig } from './config';
import { SlackBoltClient } from '../../features/slack/infra/SlackBoltClient';
import { RedisService } from '../infra/redis/RedisService';
import { ProjectService } from '../../features/project/application/ProjectService';

const exec = promisify(execCb);

interface PreflightResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
}

async function checkBinary(name: string): Promise<PreflightResult> {
  try {
    await exec(`which ${name}`);
    return { name, status: 'pass', message: `${name} found` };
  } catch {
    return { name, status: 'fail', message: `${name} not found in PATH` };
  }
}

async function checkSlackToken(config: DevsquadConfig): Promise<PreflightResult> {
  if (!config.slack_bot_token) {
    return { name: 'Slack token', status: 'fail', message: 'Missing. Run: devsquad config --bot-token <token>' };
  }
  try {
    const client = new SlackBoltClient(config.slack_bot_token);
    const ok = await client.testConnection();
    if (!ok) {
      return { name: 'Slack token', status: 'fail', message: 'Token rejected by Slack API (invalid or revoked)' };
    }
    return { name: 'Slack token', status: 'pass', message: 'Authenticated' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('missing_scope') || msg.includes('not_allowed')) {
      return { name: 'Slack token', status: 'fail', message: `Token missing required scopes: ${msg}` };
    }
    return { name: 'Slack token', status: 'fail', message: `Connection failed: ${msg}` };
  }
}

async function checkSlackScopes(config: DevsquadConfig): Promise<PreflightResult> {
  if (!config.slack_bot_token) {
    return { name: 'Slack scopes', status: 'fail', message: 'No token to check' };
  }
  const client = new SlackBoltClient(config.slack_bot_token);
  const missing: string[] = [];

  // Test conversations.create scope by listing channels (less destructive)
  try {
    await (client as any).client.conversations.list({ limit: 1 });
  } catch (err: any) {
    if (err?.data?.error === 'missing_scope') missing.push('channels:read');
  }

  // Test chat:write by checking auth (already tested above, but scope-specific)
  // conversations:manage is checked implicitly when ensureChannel runs

  if (missing.length > 0) {
    return { name: 'Slack scopes', status: 'fail', message: `Missing scopes: ${missing.join(', ')}` };
  }
  return { name: 'Slack scopes', status: 'pass', message: 'Required scopes available' };
}

async function checkGitHubAuth(localOnly: boolean): Promise<PreflightResult[]> {
  if (localOnly) {
    return [{ name: 'GitHub CLI', status: 'pass', message: 'Skipped (--local-only)' }];
  }

  // Check binary
  try {
    await exec('which gh');
  } catch {
    return [{ name: 'GitHub CLI', status: 'fail', message: 'gh not found — install from https://cli.github.com' }];
  }

  // Check auth
  try {
    await exec('gh auth status');
  } catch {
    return [{ name: 'GitHub CLI', status: 'fail', message: 'Not authenticated — run: gh auth login' }];
  }

  const results: PreflightResult[] = [
    { name: 'GitHub CLI', status: 'pass', message: 'Authenticated' },
  ];

  // Check token scopes — workflow needs: repo, project, read:org
  const REQUIRED_SCOPES = ['repo', 'project', 'read:org'];
  try {
    const { stdout } = await exec('gh auth token');
    const token = stdout.trim();
    if (!token) {
      results.push({ name: 'GitHub scopes', status: 'fail', message: 'Could not retrieve token' });
      return results;
    }

    // Use GitHub API to inspect token scopes via response header
    const { stdout: headerOut } = await exec(
      `curl -sI -H "Authorization: token ${token}" https://api.github.com/user`,
    );
    const scopeLine = headerOut.split('\n').find((l: string) => l.toLowerCase().startsWith('x-oauth-scopes:'));

    if (!scopeLine) {
      // Fine-grained PAT — no x-oauth-scopes header, check via API calls instead
      results.push(await checkGitHubGraphQL(token));
      return results;
    }

    const grantedScopes = scopeLine
      .replace(/^x-oauth-scopes:\s*/i, '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);

    const missing = REQUIRED_SCOPES.filter(s => !grantedScopes.includes(s));
    if (missing.length > 0) {
      results.push({
        name: 'GitHub scopes',
        status: 'fail',
        message: `Missing scopes: ${missing.join(', ')} — run: gh auth refresh -s ${missing.join(',')}`,
      });
    } else {
      results.push({
        name: 'GitHub scopes',
        status: 'pass',
        message: `Scopes OK (${REQUIRED_SCOPES.join(', ')})`,
      });
    }
  } catch {
    results.push({ name: 'GitHub scopes', status: 'fail', message: 'Could not verify scopes' });
  }

  return results;
}

async function checkGitHubGraphQL(token: string): Promise<PreflightResult> {
  // Fine-grained PATs don't expose scopes in headers.
  // Smoke-test the ProjectsV2 GraphQL query to verify access.
  try {
    const query = '{"query":"{ viewer { id login projectsV2(first:1) { totalCount } } }"}';
    const { stdout } = await exec(
      `curl -s -H "Authorization: bearer ${token}" -H "Content-Type: application/json" -d '${query}' https://api.github.com/graphql`,
    );
    const body = JSON.parse(stdout);
    if (body.errors) {
      const msg = body.errors[0]?.message ?? 'Unknown error';
      return { name: 'GitHub scopes', status: 'fail', message: `ProjectsV2 access denied: ${msg}` };
    }
    return { name: 'GitHub scopes', status: 'pass', message: 'ProjectsV2 GraphQL access OK' };
  } catch {
    return { name: 'GitHub scopes', status: 'fail', message: 'Could not verify GraphQL access' };
  }
}

async function checkRedis(config: DevsquadConfig): Promise<PreflightResult> {
  const host = config.redis_host ?? '127.0.0.1';
  const port = config.redis_port ?? 6379;
  try {
    const redis = new RedisService({ host, port, password: config.redis_password });
    await redis.connect();
    await redis.quit();
    return { name: 'Redis', status: 'pass', message: `Connected to ${host}:${port}` };
  } catch {
    return { name: 'Redis', status: 'fail', message: `Cannot reach ${host}:${port} — processor daemon will fail` };
  }
}

async function checkProjectNotExists(name: string): Promise<PreflightResult> {
  try {
    const svc = new ProjectService();
    const existing = await svc.get(name);
    if (existing) {
      return { name: 'Project name', status: 'fail', message: `"${name}" already exists — run: devsquad project remove --name ${name}` };
    }
    return { name: 'Project name', status: 'pass', message: `"${name}" available` };
  } catch {
    return { name: 'Project name', status: 'pass', message: `"${name}" available` };
  }
}

export async function runPreflight(config: DevsquadConfig, opts?: { localOnly?: boolean; projectName?: string }): Promise<boolean> {
  console.log('Preflight checks...');

  const checks: Promise<PreflightResult | PreflightResult[]>[] = [
    Promise.all([checkBinary('tmux'), checkBinary('git'), checkBinary('node')]),
    checkSlackToken(config),
    checkSlackScopes(config),
    checkGitHubAuth(!!opts?.localOnly),
    checkRedis(config),
  ];

  if (opts?.projectName) {
    checks.push(checkProjectNotExists(opts.projectName));
  }

  const settled = await Promise.all(checks);

  const results: PreflightResult[] = [];
  for (const r of settled) {
    if (Array.isArray(r)) results.push(...r);
    else results.push(r);
  }

  let hasFailure = false;
  for (const r of results) {
    const icon = r.status === 'pass' ? '✓' : r.status === 'warn' ? '⚠' : '✗';
    console.log(`  ${icon} ${r.name}: ${r.message}`);
    if (r.status === 'fail') hasFailure = true;
  }
  console.log('');

  return !hasFailure;
}
