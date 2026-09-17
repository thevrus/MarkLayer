import { signal } from '@preact/signals';
import { probeStatus, STATUS_LABEL, type SystemStatus } from '@site/lib/status';

export { STATUS_LABEL, type SystemStatus };

/**
 * The app footer's status, probed once per page load at import.
 *
 * No effect and no hook: the probe reacts to nothing, the answer is the same for
 * every reader of the footer, and the footer is always on the page that imports
 * this. It starts at `ok` because that is what the page itself attests, and
 * `probeStatus` only ever resolves to `degraded` on a measurement that says so.
 */
export const systemStatus = signal<SystemStatus>('ok');

void probeStatus().then((status) => {
  systemStatus.value = status;
});
