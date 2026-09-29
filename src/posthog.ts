import posthogJs from 'posthog-js';

const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const host = import.meta.env.VITE_POSTHOG_HOST as string | undefined;

if (!key || !host) {
  if (import.meta.env.DEV) {
    const variable = key ? 'VITE_POSTHOG_HOST' : 'VITE_POSTHOG_KEY';
    console.error(`${variable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${variable} is configured`);
  }
}

export const posthog = key && host
  ? posthogJs.init(key, {
      api_host: host,
      defaults: '2026-05-30',
      // The writing is private: clicks and replays never carry the text on the page or what is typed.
      mask_all_text: true,
      mask_all_element_attributes: true,
      session_recording: { maskAllInputs: true, maskTextSelector: '*' },
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      },
    })
  : undefined;
