/**
 * The MCP tool set as the marketing pages describe it, grouped by what each is
 * for. The names mirror TOOLS in packages/agent-tools without its prefix;
 * agent-tools.test.ts holds the two together. connect_room is the one tool the
 * per-link endpoint lacks, because that endpoint is already bound to its room.
 */
export interface AgentTool {
  name: string;
  does: string;
}

export const AGENT_TOOL_GROUPS: { group: string; tools: AgentTool[] }[] = [
  {
    group: 'Read',
    tools: [
      {
        name: 'read_page',
        does: "The page's headings, text, links and controls, each with the selector that finds it.",
      },
      { name: 'room_info', does: 'The URL under review, the viewport it was annotated at, and timestamps.' },
      { name: 'list_annotations', does: 'Everything left on the page, filtered by status.' },
      { name: 'get_annotation', does: 'One annotation in full, with its reply thread and any attached images.' },
      { name: 'read_attachment', does: 'Read an attached image as MCP image content.' },
      {
        name: 'diagnose',
        does: 'Capture what the page looks like around one annotation: the element and its iframe/shadow path, what actually receives the click, page errors, failed requests, zoom and scroll.',
      },
      {
        name: 'read_diagnosis',
        does: 'The stored diagnosis for one annotation, and a fresh capture when the page is still open.',
      },
      {
        name: 'get_feedback',
        does: 'One read of the room: counts by status, open items, checklist progress, poll tallies.',
      },
    ],
  },
  {
    group: 'Work',
    tools: [
      { name: 'task', does: 'Take and coordinate assigned work through the room queue.' },
      { name: 'watch_annotations', does: 'Wait for new comments, and for anything assigned to the agent by name.' },
      { name: 'acknowledge', does: 'Flip a comment to in progress so the reviewer sees it was picked up.' },
      { name: 'resolve', does: 'Close a comment and post what changed as a reply.' },
      { name: 'dismiss', does: 'Decline a comment. The reason is required, and the reviewer reads it.' },
      { name: 'reply', does: 'Ask a question on the thread without moving its status.' },
    ],
  },
  {
    group: 'Review',
    tools: [
      { name: 'create_annotation', does: 'Leave its own comment, pinned to an element, one per finding.' },
      { name: 'suggest_edit', does: 'Propose exact replacement text, shown to the reviewer as a diff to accept.' },
    ],
  },
  {
    group: 'Hand off',
    tools: [
      { name: 'share_preview', does: 'Open a review room on a preview URL and return the link to send a human.' },
      { name: 'set_next_steps', does: 'Publish a checklist of planned changes, each tied to the comments it answers.' },
      { name: 'complete_next_step', does: 'Tick a step off while the reviewers watch.' },
      { name: 'ask', does: 'Put a multiple-choice question to the room and read the votes back.' },
    ],
  },
  {
    group: 'Teach',
    tools: [
      { name: 'teach_start', does: 'Start a temporary presentation for the room.' },
      { name: 'teach_step', does: 'Highlight a target and show a caption for a presentation step.' },
      { name: 'teach_end', does: 'End a presentation for the room.' },
    ],
  },
  {
    group: 'npm only',
    tools: [{ name: 'connect_room', does: 'Switch to another share link by URL or id.' }],
  },
];

/** Return the public tool name; teaching tools use their protocol names directly. */
export function agentToolName(tool: AgentTool): string {
  return tool.name.startsWith('teach_') ? tool.name : `marklayer_${tool.name}`;
}

export const AGENT_TOOLS: AgentTool[] = AGENT_TOOL_GROUPS.flatMap((g) => g.tools);
