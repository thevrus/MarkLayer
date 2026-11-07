import type { OutboundDestination } from '../room-outbound';
import { type SlackEnv, slackConfig } from './slack-config';
import { isSlackOp } from './slack-format';
import { slackStore } from './slack-store';
import { postBatchToSlack } from './slack-sync';

/** The Slack app. Absent unless all of it is configured, the same test its routes make. */
function slackDestination(env: SlackEnv): OutboundDestination | null {
  const config = slackConfig(env);
  if (!config) return null;
  return {
    replaces: 'slack',
    async open(room) {
      const install = await slackStore(room.db).install(room.roomId);
      if (!install) return null;
      return async (batch) => {
        // Ops that came from Slack never go back to Slack: that is what stops a reply echoing.
        const items = batch.filter((op) => !isSlackOp(op));
        return items.length ? postBatchToSlack({ ...room, tokenKey: config.tokenKey, install, items }) : null;
      };
    },
  };
}

/** Everywhere a room posts other than its webhook providers. */
export function roomDestinations(env: SlackEnv): OutboundDestination[] {
  return [slackDestination(env)].filter((d) => d !== null);
}
