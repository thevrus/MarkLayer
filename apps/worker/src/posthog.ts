type CaptureProps = Record<string, string | number | boolean | null | undefined>;

export function captureServer(
  env: { POSTHOG_KEY?: string; POSTHOG_HOST?: string },
  ctx: ExecutionContext,
  event: string,
  props: CaptureProps,
  distinctId = 'worker',
) {
  const key = env.POSTHOG_KEY;
  if (!key) return;
  const host = env.POSTHOG_HOST || 'https://us.i.posthog.com';
  const body = JSON.stringify({
    api_key: key,
    event,
    distinct_id: distinctId,
    properties: { source: 'worker', ...props },
    timestamp: new Date().toISOString(),
  });
  ctx.waitUntil(
    fetch(`${host}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {}),
  );
}
