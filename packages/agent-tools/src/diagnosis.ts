import type { AnnotationOp, Diagnosis } from '@marklayer/types/ops';
import { MAX_DIAGNOSIS_RECENT } from '@marklayer/types/relay';

function cleanText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"'<>]+/gi, (raw) => safePageUrl(raw))
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:token|key|auth|session|user|email|code|secret)[^=]*=)[^&#\s]*/gi, '$1[redacted]')
    .replace(/\b(user|account|session|token|secret|api[_-]?key)(?:[_ -]?id)?\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[redacted]')
    .replace(/\b[\da-f]{8}-[\da-f-]{27,}\b/gi, '[id]')
    .replace(/\b[a-z\d_-]{24,}\b/gi, '[id]');
}

function safePageUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    const path = url.pathname
      .split('/')
      .map((part, i, all) => {
        const prior = all[i - 1]?.toLowerCase();
        if (
          [
            'user',
            'users',
            'account',
            'accounts',
            'session',
            'sessions',
            'token',
            'tokens',
            'profile',
            'profiles',
          ].includes(prior ?? '')
        )
          return ':id';
        return /^[\da-f]{8}-[\da-f-]{27,}$/i.test(part) || /^[a-z\d_-]{24,}$/i.test(part) ? ':id' : part;
      })
      .join('/');
    return `${url.origin}${path}`;
  } catch {
    return '';
  }
}

function scrub<T>(value: T): T {
  if (typeof value === 'string') return cleanText(value) as T;
  if (Array.isArray(value)) return value.map(scrub) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, scrub(child)])) as T;
  return value;
}

/** Conservative MCP-side package when no extension-collected live snapshot exists yet. */
export function buildStoredDiagnosis(op: AnnotationOp, capturedAt = Date.now(), pageHref?: string): Diagnosis {
  const meta = op.tool === 'comment' ? op.meta : undefined;
  /** An inspect annotation carries selector/rect instead of an anchor target. */
  const target = 'target' in op && op.target ? scrub(op.target) : undefined;
  const sourceUrl = meta?.url ? safePageUrl(meta.url) : pageHref ? safePageUrl(pageHref) : '';
  const reproductionSteps = [
    ...(sourceUrl ? [`打开页面来源 ${sourceUrl}`] : []),
    ...(target?.selector ? [`定位批注目标 ${cleanText(target.selector)}`] : []),
  ];
  const pageErrors = (meta?.errors ?? []).map((error) => ({
    ...error,
    message: cleanText(error.message),
    ...(error.source ? { source: safePageUrl(error.source) } : {}),
  }));
  const networkFailures = (meta?.networkErrors ?? []).map((error) => ({ ...error, url: safePageUrl(error.url) }));
  return {
    capturedAt,
    source: 'stored-annotation',
    ...(target ? { target } : {}),
    pageErrorCount: pageErrors.length,
    pageErrors: pageErrors.slice(-MAX_DIAGNOSIS_RECENT),
    networkFailureCount: networkFailures.length,
    networkFailures: networkFailures.slice(-MAX_DIAGNOSIS_RECENT),
    reproductionSteps: reproductionSteps.slice(0, 6),
    partial: true,
  };
}

/** Apply the same privacy filtering to live observations before attaching them to an op. */
export function sanitizeDiagnosis(diagnosis: Diagnosis): Diagnosis {
  return scrub(diagnosis);
}
