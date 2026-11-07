import { batchAvailable } from './batch';
import { configureHost, type HostActions, type HostCapabilities, host } from './host-config';
import { hydrateIdentity } from './identity';
import { openDrafts } from './ops';
import { hydrateStorage } from './storage';
import { wireToolState } from './tool-state';
import { wireUiState } from './ui-state';

export interface HostOptions {
  /** Where the API lives. Absent, production; the widget passes whichever origin served it. */
  origin?: string;
  capabilities?: Partial<HostCapabilities>;
  actions?: HostActions;
}

let wired = false;

/**
 * Every host calls this once, before it renders. It is the only thing that reads or
 * writes storage, opens drafts or starts the kernel's effects, so importing the kernel
 * does nothing to the page it lands on. Omitted capabilities default to what a page
 * of our own may do; a host on someone else's site turns them off.
 */
export function initHost(options: HostOptions = {}) {
  configureHost(options);
  const { capabilities } = host;
  hydrateStorage({ persist: capabilities.persist });
  hydrateIdentity(capabilities.identity);
  openDrafts(capabilities.drafts);
  batchAvailable.value = capabilities.batch;
  if (wired) return;
  wired = true;
  wireToolState();
  wireUiState();
}
