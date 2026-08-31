import { mailerFor } from './providers';
import type { EmailEnv, EmailTemplate } from './types';

/**
 * The one place email leaves the Worker.
 *
 * Generic over the template's own data type, so there is no registry lookup to
 * cast and no way to pass a comment notification's fields to a sign-in.
 */
export async function sendEmail<Data>({
  env,
  to,
  template,
  data,
}: {
  env: EmailEnv;
  to: string;
  template: EmailTemplate<Data>;
  data: Data;
}): Promise<void> {
  await mailerFor(env).send({ to, ...template.render(data) });
}
