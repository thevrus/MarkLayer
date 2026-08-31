/**
 * The email engine's contracts. Mirrors `integrations/types.ts`: everything here
 * is a pure description, and exactly one module (`send.ts`) performs I/O.
 */

import { z } from 'zod/mini';

/** One message, ready to hand to a provider. */
export const mailerMessageSchema = z.object({
  to: z.string(),
  subject: z.string(),
  text: z.string(),
  html: z.string(),
});

export type MailerMessage = z.infer<typeof mailerMessageSchema>;

/** A destination that can put a message in front of a person. */
export interface Mailer {
  id: string;
  send(message: MailerMessage): Promise<void>;
}

/**
 * One email the product can send.
 *
 * `Data` is per-template rather than a shared bag, so a caller cannot send a
 * comment notification with a sign-in's fields. The markup itself comes from
 * `@marklayer/emails`, which renders React Email templates at build time —
 * @react-email/render cannot run in the Workers runtime.
 */
export interface EmailTemplate<Data> {
  id: string;
  render(data: Data): { subject: string; html: string; text: string };
}

export interface EmailEnv {
  /** Cloudflare Email Service send binding. Absent in dev and in a fork with no sending domain. */
  EMAIL?: { send(message: unknown): Promise<void> };
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
}
