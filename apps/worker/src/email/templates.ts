import { fill, inviteEmail, type RenderedTemplate, signInEmail } from '@marklayer/emails';
import type { EmailTemplate } from './types';

/**
 * Templates are rendered to HTML in `packages/emails` at build time and arrive
 * here as strings. `RenderedTemplate` already carries each template's
 * placeholder keys, so this binds typed data to them without a hand-written
 * `Data` interface per template — each call still infers its own `Keys`, so a
 * caller still cannot pass a comment notification's fields to a sign-in.
 */
function defineTemplate<Keys extends string>(
  rendered: RenderedTemplate<Keys>,
): EmailTemplate<Readonly<Record<Keys, string>>> {
  return { id: rendered.id, render: (values) => fill({ template: rendered, values }) };
}

export const signInTemplate = defineTemplate(signInEmail);
export const inviteTemplate = defineTemplate(inviteEmail);
