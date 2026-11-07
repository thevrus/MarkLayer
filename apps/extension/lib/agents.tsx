import { canonicalAgent } from '@marklayer/types/agents';
import { Bot } from 'lucide-preact';
import {
  siClaude,
  siCline,
  siCursor,
  siGithubcopilot,
  siGooglegemini,
  siWindsurf,
  siZedindustries,
} from 'simple-icons';

/**
 * Brand marks for the agents that connect to a room. Names and colours live in
 * `@marklayer/types` beside the rest of the agent data; only the path data is UI.
 *
 * simple-icons normalizes every glyph to one 24x24 grid at a consistent optical
 * weight, so a wide glyph and a compact one read as equals in a row. An agent
 * with no published mark gets the generic one; an invented logo is worse.
 */

/** Keyed on the canonical brand, so an alias like `gemini-cli` needs no row here. */
const AGENT_MARKS: Record<string, string> = {
  claude: siClaude.path,
  cursor: siCursor.path,
  gemini: siGooglegemini.path,
  copilot: siGithubcopilot.path,
  windsurf: siWindsurf.path,
  cline: siCline.path,
  zed: siZedindustries.path,
};

/**
 * One mark, one grid, one colour. `size` is the box; the glyph fills it the same
 * amount every time because every path is drawn to the same 24x24 frame.
 */
export function AgentMark({ id, size = 12 }: { id: string; size?: number }) {
  const d = AGENT_MARKS[canonicalAgent(id)];
  if (!d) return <Bot size={size + 1} strokeWidth={2} aria-hidden="true" />;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      class="shrink-0"
      role="img"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
