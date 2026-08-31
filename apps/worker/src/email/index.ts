// The folder's real surface: one send function, one template, and the bindings
// it reads. Everything else is internal and imported by relative path.
export { sendEmail } from './send';
export { signInTemplate } from './templates';
export type { EmailEnv } from './types';
