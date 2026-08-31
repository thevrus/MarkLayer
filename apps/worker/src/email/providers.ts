import { buildMimeMessage } from './mime';
import type { EmailEnv, Mailer } from './types';

/**
 * Where a message actually goes. Same shape as `integrations/providers.ts`: a
 * small set of interchangeable implementations behind one interface, chosen by
 * configuration rather than by an import at the call site.
 */

/**
 * Cloudflare Email Service. Sending to an address that is not a verified
 * destination on the account requires an onboarded sending domain (SPF, DKIM,
 * DMARC and bounce records on marklayer.app) — without that step every send to
 * a real signup fails, so treat a delivery error here as configuration.
 */
export function cloudflareMailer({
  binding,
  from,
}: {
  binding: { send(message: unknown): Promise<void> };
  from: string;
}): Mailer {
  return {
    id: 'cloudflare',
    async send(message) {
      // Imported lazily so a fork without the binding never pulls the module.
      const { EmailMessage } = await import('cloudflare:email');
      await binding.send(new EmailMessage(from, message.to, buildMimeMessage({ from, message })));
    },
  };
}

/** The swap if Cloudflare's unpublished daily quota bites. Plain fetch, no SDK. */
export function resendMailer({ apiKey, from }: { apiKey: string; from: string }): Mailer {
  return {
    id: 'resend',
    async send(message) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `MarkLayer <${from}>`,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
      if (!res.ok) throw new Error(`resend responded ${res.status}`);
    },
  };
}

/** Dev only. Prints the message so `bun dev` can sign in with no provider configured. */
export function consoleMailer(): Mailer {
  return {
    id: 'console',
    async send(message) {
      console.log(`[email] to=${message.to} subject=${message.subject}\n${message.text}`);
    },
  };
}

/**
 * Picks a provider from what is configured, in preference order. A fork with
 * neither binding still boots and still signs people in — the link goes to the
 * log instead of an inbox, which is what `bun dev` wants.
 */
export function mailerFor(env: EmailEnv): Mailer {
  const from = env.MAIL_FROM ?? 'login@marklayer.app';
  if (env.EMAIL) return cloudflareMailer({ binding: env.EMAIL, from });
  if (env.RESEND_API_KEY) return resendMailer({ apiKey: env.RESEND_API_KEY, from });
  return consoleMailer();
}
