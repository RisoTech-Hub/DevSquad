import { Command } from 'commander';
import { ensureConfig } from './shared/utils/config';
import { configCommand } from './features/config/commands/config';
import { daemonCommand, runListenerCommand, runProcessorCommand } from './features/daemon';
import { projectCommand } from './features/project';
import { slackCommand } from './features/slack';
import { taskCommand } from './features/github';
import { agentCommand } from './features/agent';
import { doctorCommand } from './features/doctor';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require('../package.json');

const program = new Command();

async function main(): Promise<void> {
  await ensureConfig();

  program
    .name('devsquad')
    .description('CLI tool bridging Slack with Claude Orchestrator sessions')
    .version(version);

  program
    .command('config')
    .description('View or set devsquad configuration (Slack tokens)')
    .option('--bot-token <token>', 'Set Slack Bot Token (xoxb-...)')
    .option('--app-token <token>', 'Set Slack App Token (xoxa-...)')
    .option('--view', 'View current configuration')
    .option('--set <key=value>', 'Set a config key (e.g. --set protocol_base=/path)')
    .action(configCommand);

  daemonCommand(program);
  projectCommand(program);
  agentCommand(program);
  slackCommand(program);
  taskCommand(program);
  doctorCommand(program);

  program
    .command('_run-listener')
    .description('Internal: run the Slack listener process (used by LaunchAgent)')
    .action(runListenerCommand);

  program
    .command('_run-processor <project>')
    .description('Internal: run the message processor for a project (used by LaunchAgent)')
    .action(runProcessorCommand);

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
