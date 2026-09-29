import { PostHog } from 'posthog-node';

let posthog: PostHog | null | undefined;

/** The server's PostHog client, or null without a key (local runs, tests). */
export function posthogClient() {
  if (posthog !== undefined) return posthog;
  const key = process.env.VITE_POSTHOG_KEY;
  const host = process.env.VITE_POSTHOG_HOST;
  if (process.env.NODE_ENV !== 'production') {
    if (!key) console.error('VITE_POSTHOG_KEY variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_POSTHOG_KEY is configured');
    if (!host) console.error('VITE_POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_POSTHOG_HOST is configured');
  }
  // Privacy mode: LLM analytics keep model, tokens, cost and timing, never the blurt or what the parser cut from it.
  posthog = key && host
    ? new PostHog(key, { host, privacyMode: true, enableExceptionAutocapture: true })
    : null;
  return posthog;
}

/** Server errors the writer never sees, sent to PostHog error tracking. */
export function captureServerError(err: unknown, distinctId?: string) {
  posthogClient()?.captureException(err, distinctId);
}
