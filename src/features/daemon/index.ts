import { LaunchDaemonManager } from './infra/LaunchDaemonManager';

export { daemonCommand } from './commands/daemon';
export { runListenerCommand } from './commands/run-listener';
export { runProcessorCommand } from './commands/run-processor';
export { DaemonStatusService } from './application/DaemonStatusService';
export type { DaemonState } from './application/DaemonStatusService';
export type { DaemonDefinition, DaemonStatus } from './infra/LaunchDaemonManager';
export { LISTENER_LABEL, processorLabel, getNodeBin, getDevsquadBin, killStaleListeners } from './utils/daemon';

/** Creates a LaunchDaemonManager instance without exposing the infra class directly. */
export function createLaunchDaemonManager(): LaunchDaemonManager {
  return new LaunchDaemonManager();
}
