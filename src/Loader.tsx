import { useEffect, useRef, useState } from 'react';

/**
 * The wait after sign-in, before the page is ready: the inkwell tips, rolls half a turn, stands up, and does it again the
 * other way. Rendered to public/loading.* from the three.js scene on the logo-animation branch (scripts/logo/scene.html,
 * roll story, fixed camera); the app itself only plays the video. Every loader keeps time with the page
 * clock, so when one wait hands to the next the roll carries on instead of starting over; only the first one fades in.
 */
/**
 * The roll plays once per browser session. A reload after that hands straight over: no hold, and while the page really
 * is loading, only the still inkwell, fading in after a beat so a quick load shows nothing at all. Storage that can't
 * be read counts as not seen, so the roll plays.
 */
const SEEN = 'loader-seen';
const seen = (() => { try { return sessionStorage.getItem(SEEN) === '1'; } catch { return false; } })();
const markSeen = () => { try { sessionStorage.setItem(SEEN, '1'); } catch { /* storage unavailable: it plays again next time */ } };

/** The loader stays up at least this long from when it first appears, so the roll is seen even when loading is instant. */
const HOLD_MS = seen ? 0 : 5000;
let firstAt: number | null = null;

/** True until the loader has been up for HOLD_MS. */
export function useLoaderHold() {
  const [, rerender] = useState(0);
  const left = firstAt === null ? HOLD_MS : HOLD_MS - (performance.now() - firstAt);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => rerender((n) => n + 1), left);
    return () => clearTimeout(id);
  });
  return left > 0;
}

export function Loader() {
  const video = useRef<HTMLVideoElement>(null);
  const [fade] = useState(() => firstAt === null);
  firstAt ??= performance.now();
  useEffect(() => { if (!seen) markSeen(); }, []);
  if (seen) return <div className="loader quiet" role="status" aria-label="Loading"><img src="/loading.png" alt="" /></div>;
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const sync = () => {
    const v = video.current;
    if (v?.duration) v.currentTime = (performance.now() / 1000) % v.duration;
  };
  return (
    <div className={`loader ${fade ? 'fade' : ''}`} role="status" aria-label="Loading">
      {still ? <img src="/loading.png" alt="" /> : (
        <video ref={video} autoPlay loop muted playsInline poster="/loading.png" onLoadedMetadata={sync}>
          <source src="/loading.webm" type="video/webm" />
          <source src="/loading.mp4" type="video/mp4" />
        </video>
      )}
    </div>
  );
}
