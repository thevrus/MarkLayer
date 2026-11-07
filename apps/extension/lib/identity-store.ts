import type { IdentityStore } from './host-config';
import { lsGet, lsSet } from './storage';

/** Only imported by hosts on our own terms: naming these keys anywhere the widget reaches would ship them to customer sites. */
export const localIdentity: IdentityStore = {
  load: () => ({ name: lsGet('ml-username'), color: lsGet('ml-usercolor'), id: lsGet('ml-clientid') }),
  save: ({ name, color, id }) => {
    if (name) lsSet('ml-username', name);
    if (color) lsSet('ml-usercolor', color);
    if (id) lsSet('ml-clientid', id);
  },
};
