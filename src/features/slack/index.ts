import { SlackService } from './application/SlackService';
import { SlackBoltClient } from './infra/SlackBoltClient';
import { SlackSocketModeAdapter } from './infra/SlackSocketModeAdapter';

export { SlackService };
export type { ISlackClient } from './domain/ISlackClient';
export type { ISlackSocket, IncomingSlackMessage, MessageHandler } from './domain/ISlackSocket';
export { slackCommand } from './commands/slack';

/** Creates a one-way SlackService (no socket listener) for sending messages. */
export function createSlackClient(botToken: string): SlackService {
  return new SlackService(new SlackBoltClient(botToken), null as never);
}

/** Creates a full SlackService with Socket Mode listener for receiving messages. */
export function createSlackListener(botToken: string, appToken: string): SlackService {
  return new SlackService(new SlackBoltClient(botToken), new SlackSocketModeAdapter(botToken, appToken));
}
