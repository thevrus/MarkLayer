import { authStore } from './auth';
import type { Env } from './env';
import { FAILURE_WINDOW_SECONDS, unlockFailureStore } from './lock/failures';
import { resetDemoRoom, sweepExpired } from './rooms-lifecycle';
import { nowInSeconds } from './time';

export const RETENTION_CRON = '0 3 * * *';

export const scheduled: ExportedHandlerScheduledHandler<Env['Bindings']> = async (event, env) => {
  // Both crons match at 03:00 and Cloudflare fires one invocation per
  // expression, so the reset rides the hourly tick or it happens twice.
  if (event.cron !== RETENTION_CRON) {
    await resetDemoRoom(env);
    return;
  }

  // Rooms, projects, their cards, Slack threads and uploads, under one deadline rule.
  await sweepExpired({ env });

  // Expired sessions and spent magic links are dead weight, not history.
  await authStore(env.DB).sweepExpired();
  await unlockFailureStore(env.DB).sweep(nowInSeconds() - FAILURE_WINDOW_SECONDS);
};
