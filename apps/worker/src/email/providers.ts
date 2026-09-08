import type { EmailEnv, EmailSendBinding, Mailer } from './types';

/**
 * Where a message actually goes. Same shape as `integrations/providers.ts`: a
 * small set of interchangeable implementations behind one interface, chosen by
 * configuration rather than by an import at the call site.
 */

/** The display name on every outgoing message, whichever provider carries it. */
const FROM_NAME = 'MarkLayer';

/**
 * Cloudflare Email Service. Sending to an address that is not a verified
 * destination on the account needs an onboarded sending domain (Compute > Email
 * Service > Email Sending adds the SPF, DKIM, DMARC and bounce records) and a
 * Workers Paid plan — without both, every send to a real signup fails, so treat
 * a delivery error here as configuration.
 */
export function cloudflareMailer({ binding, from }: { binding: EmailSendBinding; from: string }): Mailer {
  return {
    id: 'cloudflare',
    async send(message) {
      await binding.send({ from: { email: from, name: FROM_NAME }, ...message });
    },
  };
}

/** The swap if Cloudflare's daily quota bites. Plain fetch, no SDK. */
export function resendMailer({ apiKey, from }: { apiKey: string; from: string }): Mailer {
  return {
    id: 'resend',
    async send(message) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${FROM_NAME} <${from}>`,
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
 * Picks a provider. Unset `MAIL_PROVIDER` takes whatever is configured — the
 * EMAIL binding first, then Resend, console last — which is what `bun dev` and a
 * fork with no provider at all want.
 *
 * Setting it pins the choice, and a pin naming a provider with no binding or key
 * throws rather than falling through to the console: production answered 200 to
 * every sign-in for weeks while printing the links to the log, and a switch that
 * can fail that quietly is not a switch worth having.
 */
export function mailerFor(env: EmailEnv): Mailer {
  const from = env.MAIL_FROM ?? 'login@marklayer.app';
  // Auto-detect resolves to a name, so a pin and an unset variable then take the
  // same validated branch instead of each building the mailers separately.
  const provider = env.MAIL_PROVIDER || (env.EMAIL ? 'cloudflare' : env.RESEND_API_KEY ? 'resend' : 'console');
  switch (provider) {
    case 'cloudflare':
      if (!env.EMAIL) throw new Error('MAIL_PROVIDER=cloudflare but no EMAIL binding is bound');
      return cloudflareMailer({ binding: env.EMAIL, from });
    case 'resend':
      if (!env.RESEND_API_KEY) throw new Error('MAIL_PROVIDER=resend but RESEND_API_KEY is unset');
      return resendMailer({ apiKey: env.RESEND_API_KEY, from });
    case 'console':
      return consoleMailer();
    // A typo here would otherwise fall through to the console and look fine.
    default:
      throw new Error(`unknown MAIL_PROVIDER "${env.MAIL_PROVIDER}"`);
  }
}
