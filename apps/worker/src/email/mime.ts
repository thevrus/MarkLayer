import { base64Utf8 } from '../http';
import type { MailerMessage } from './types';

/** Base64 bodies must be line-wrapped to stay inside SMTP's 998-octet line limit. */
function wrap(value: string): string {
  const lines: string[] = [];
  for (let i = 0; i < value.length; i += 76) lines.push(value.slice(i, i + 76));
  return lines.join('\r\n');
}

/**
 * A multipart/alternative message. The plain-text part is not decoration:
 * HTML-only transactional mail is scored as spam by most filters, which for a
 * login link means the person simply never gets in.
 */
export function buildMimeMessage({ from, message }: { from: string; message: MailerMessage }): string {
  const boundary = `ml-${crypto.randomUUID()}`;
  return [
    `From: MarkLayer <${from}>`,
    `To: ${message.to}`,
    `Subject: =?utf-8?B?${base64Utf8(message.subject)}?=`,
    `Message-ID: <${crypto.randomUUID()}@marklayer.app>`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(base64Utf8(message.text)),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(base64Utf8(message.html)),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}
