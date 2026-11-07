import { operations } from '@ext/lib/ops';
import { toast } from '@ext/lib/toasts';
import { shareUrl } from '@marklayer/brand/links';
import { nanoid } from 'nanoid';
import { capture } from './analytics';
import { annotationId, originalWidth, pageUrl, projectId, saveRoom } from './projects';
import { noteSupportSignal } from './support';
import { maybeOfferSupport } from './support-ui';
import { sharing } from './ui-state';

/** A beat after the toast, so the card arrives at a pause rather than on top of the thing that just succeeded. */
const OFFER_DELAY_MS = 1200;

/** The link a share copies and the share card displays: showing one link while copying another is a small lie. */
export function roomLink({ pid, id }: { pid: string | null; id: string }): string | null {
  if (pid) return shareUrl({ origin: location.origin, kind: 'project', id: pid, ref: 'web' });
  return id ? shareUrl({ origin: location.origin, kind: 'page', id, ref: 'web' }) : null;
}

async function shareProject(pid: string) {
  try {
    await navigator.clipboard.writeText(roomLink({ pid, id: '' }) ?? '');
    toast('Project link copied', { type: 'success' });
  } catch {
    toast('Failed to copy link', { type: 'error' });
  }
}

async function sharePage() {
  const id = annotationId.value || nanoid();
  annotationId.value = id;

  // Copy link immediately so the user gets instant feedback
  await navigator.clipboard.writeText(roomLink({ pid: null, id }) ?? '');
  toast('Link copied', { type: 'success' });

  const saved = await saveRoom({
    id,
    ops: operations.value,
    url: pageUrl.value || location.origin,
    width: originalWidth.value || window.innerWidth,
  });
  if (!saved) {
    // A copied link that never saved is the worst failure the product has: the
    // person walks away believing they shared something.
    capture('share_failed', { ops: operations.value.length });
    toast('Failed to save — link may not work', { type: 'error' });
    return;
  }
  capture('share_created', { readonly: false, ops: operations.value.length, expires: false });
  // Only a link that actually saved counts as the tool having worked.
  noteSupportSignal('shared');
  window.setTimeout(maybeOfferSupport, OFFER_DELAY_MS);
}

/** What Share does in the web app. A project's pages persist as they are added, so its link needs no save. */
export async function shareRoom() {
  if (sharing.value) return;
  sharing.value = true;
  const pid = projectId.value;
  try {
    await (pid ? shareProject(pid) : sharePage());
  } finally {
    sharing.value = false;
  }
}
