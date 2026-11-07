import type * as Real from '../../components/CommentTriage';

// Widget stand-in, for size: dropping the Status/Assignee menus drops Base UI's Menu.
// That a visitor does not triage is `capabilities.triage`, not this file.

export const TriageSection: typeof Real.TriageSection = () => <></>;
