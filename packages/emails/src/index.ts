import { SIGN_IN_HTML } from './generated';
import * as signIn from './templates/sign-in.meta';

/**
 * The package's whole public surface: templates already rendered to HTML, plus
 * the substitution helper.
 *
 * Nothing here imports React. The .tsx templates and @react-email are
 * build-time only, which is what keeps a React runtime out of the Worker.
 */
export interface RenderedTemplate<Keys extends string> {
  id: string;
  subject: string;
  html: string;
  text: string;
  /** The `{{token}}` strings this template expects `fill` to replace. */
  placeholders: Readonly<Record<Keys, string>>;
}

export const signInEmail: RenderedTemplate<'link'> = {
  id: signIn.id,
  subject: signIn.subject,
  html: SIGN_IN_HTML,
  text: signIn.text,
  placeholders: signIn.PLACEHOLDER,
};

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/**
 * Substitutes a template's placeholders.
 *
 * The HTML copy is escaped and the text copy is not — a URL carrying `&` would
 * otherwise break the markup around it. Throws on a leftover token rather than
 * mailing a literal `{{link}}` to someone trying to sign in.
 */
export function fill<Keys extends string>({
  template,
  values,
}: {
  template: RenderedTemplate<Keys>;
  values: Readonly<Record<Keys, string>>;
}): { subject: string; html: string; text: string } {
  let html = template.html;
  let text = template.text;
  // Both records widened to string keys rather than asserting `Object.entries`'
  // key back to `Keys`: an assignment proves what a cast only claims, and a
  // missing value falls through to the leftover check below.
  const placeholders: Readonly<Record<string, string>> = template.placeholders;
  const substitutions: Readonly<Record<string, string>> = values;
  for (const [key, token] of Object.entries(placeholders)) {
    const value = substitutions[key];
    if (value === undefined) continue;
    html = html.replaceAll(token, escapeHtml(value));
    text = text.replaceAll(token, value);
  }
  const leftover = html.match(/{{\w+}}/);
  if (leftover) throw new Error(`${template.id}: unsubstituted placeholder ${leftover[0]}`);
  return { subject: template.subject, html, text };
}
