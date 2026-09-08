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

/**
 * Cloudflare Email Service's structured send binding, narrowed to the fields we
 * actually pass. Declared here rather than taken from the runtime types so the
 * folder still compiles in a checkout with no `send_email` binding configured.
 */
export interface EmailSendBinding {
  send(message: MailerMessage & { from: { email: string; name?: string } }): Promise<{ messageId: string }>;
}

export interface EmailEnv {
  /** Cloudflare Email Service send binding. Absent in dev and in a fork with no sending domain. */
  EMAIL?: EmailSendBinding;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  /**
   * Pins the provider: 'cloudflare' | 'resend' | 'console'. Unset picks whatever
   * is configured, which is what `bun dev` wants; a deployment sets it so a
   * missing binding fails the send instead of quietly logging it.
   */
  MAIL_PROVIDER?: string;
}
