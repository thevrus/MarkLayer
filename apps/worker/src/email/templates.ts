import { fill, signInEmail } from '@marklayer/emails';
import type { EmailTemplate } from './types';

export interface SignInData {
  link: string;
}

/**
 * Templates are rendered to HTML in `packages/emails` at build time and arrive
 * here as strings. This module's job is only to bind typed data to them, so a
 * caller cannot pass a comment notification's fields to a sign-in.
 */
export const signInTemplate: EmailTemplate<SignInData> = {
  id: signInEmail.id,
  render: (data) => fill({ template: signInEmail, values: { link: data.link } }),
};
