import { onSupport } from '@ext/lib/ui-state';
import { useSignalEffect } from '@preact/signals';
import { SupportDialog } from '../SupportDialog';
import { openSupportCard, watchAgentWork, watchNotes, watchSupportPaid } from '../support-ui';

/** Authoring-only chrome. A guest is somebody else's visitor and gets none of it. */
export function AuthoringChrome() {
  // The settings panel is the extension's, and the card is not. Publishing the
  // opener from the same component that renders the card is what keeps that row
  // honest: it exists exactly as long as there is something for it to open.
  useSignalEffect(() => {
    onSupport.value = () => openSupportCard('menu');
    // The thank-you is watched for on the same lifecycle, and for the same
    // reason: only somebody who could be asked can have paid, so a read-only
    // guest neither sees the card nor hears back about one.
    const stopWatchingPaid = watchSupportPaid();
    const stopWatchingAgents = watchAgentWork();
    const stopWatchingNotes = watchNotes();
    return () => {
      onSupport.value = null;
      stopWatchingPaid();
      stopWatchingAgents();
      stopWatchingNotes();
    };
  });

  return <SupportDialog />;
}
