/** A string for the inside of a double-quoted literal in an injected script. */
export function escapeForScript(s: string): string {
  return JSON.stringify(s).slice(1, -1);
}
