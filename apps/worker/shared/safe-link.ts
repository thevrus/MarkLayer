/**
 * Outlook rewrites every link in a message to `<region>.safelinks.protection.outlook.com/?url=<real>`,
 * so a link pasted from an email names the scanner, which challenges the proxy. Returns the real
 * target, or the input untouched when it is not a Safe Link or carries no http(s) target.
 */
export function unwrapSafeLink(raw: string): string {
  try {
    const u = new URL(raw);
    if (
      u.hostname !== 'safelinks.protection.outlook.com' &&
      !u.hostname.endsWith('.safelinks.protection.outlook.com')
    ) {
      return raw;
    }
    const target = u.searchParams.get('url');
    return target && /^https?:\/\//i.test(target) ? target : raw;
  } catch {
    return raw;
  }
}
