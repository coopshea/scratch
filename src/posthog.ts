import posthogJs, { DisplaySurveyType } from 'posthog-js';

const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const host = import.meta.env.VITE_POSTHOG_HOST as string | undefined;

if (!key || !host) {
  if (import.meta.env.DEV) {
    const variable = key ? 'VITE_POSTHOG_HOST' : 'VITE_POSTHOG_KEY';
    console.error(`${variable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${variable} is configured`);
  }
}

// The writing is private: clicks and replays never carry the text on the page or what is typed.
const MASKED = { mask_all_text: true, mask_all_element_attributes: true, session_recording: { maskAllInputs: true, maskTextSelector: '*' } };
// An owner's own sessions, in full, to study how the tool is used. Passwords (the API keys) stay masked; a defined
// selector that matches only opt-in .ph-mask keeps the project's server-side masking from filling the gap.
const OPEN = { mask_all_text: false, mask_all_element_attributes: false, session_recording: { maskAllInputs: false, maskTextSelector: '.ph-mask' } };

export const posthog = key && host
  ? posthogJs.init(key, {
      api_host: host,
      defaults: '2026-05-30',
      ...MASKED,
      // Masking is fixed when the recorder starts, so it waits for recordReplay to know who is writing.
      disable_session_recording: true,
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      },
    })
  : undefined;

let replay: 'masked' | 'open' | undefined;
/** Start the session replay, masked for everyone but the site's owners (ADMIN_EMAILS), who are recorded in full. */
export function recordReplay(full: boolean) {
  const want = full ? 'open' : 'masked';
  if (!posthog || replay === want) return;
  if (replay) posthog.stopSessionRecording(); // signed in from the welcome page: restart the recorder with the new masking
  posthog.set_config(full ? OPEN : MASKED);
  posthog.startSessionRecording();
  replay = want;
}

/**
 * The "Scratch feedback" survey in PostHog. It opens only from here: its display condition waits on an event the app
 * never sends, so it never pops up by itself, and ignoreConditions lets a writer send feedback as often as they like.
 */
const FEEDBACK_SURVEY = '01a0eec3-d036-0000-4b8e-3edfcafe7cfb';
export const openFeedback = posthog
  ? () => posthog.displaySurvey(FEEDBACK_SURVEY, { displayType: DisplaySurveyType.Popover, ignoreConditions: true, ignoreDelay: true })
  : undefined;
