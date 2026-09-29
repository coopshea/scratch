/** The few line icons the interface uses: 1.75 stroke, round caps, in the colour of the text beside them. */
const PATHS = {
  panel: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M9.5 4.5v15" /></>,
  chevron: <path d="m9.5 6 6 6-6 6" />,
  down: <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  scissors: <><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="6.5" cy="17.5" r="2.5" /><path d="M8.6 8 19.5 18.5M8.6 16 19.5 5.5" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  download: <path d="M12 4.5v10M7.5 10.5l4.5 4.5 4.5-4.5M5 19.5h14" />,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></>,
  key: <><circle cx="8" cy="15.5" r="3.5" /><path d="m10.5 13 8.5-8.5M16 7.5l2.5 2.5" /></>,
  check: <path d="M5 12.5 10 17.5 19 7" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  chat: <path d="M5.5 5.5h13a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5v-3.5a1.5 1.5 0 0 1-1.5-1.5V7a1.5 1.5 0 0 1 1.5-1.5Z" />,
  mic: <><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" /></>,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, small }: { name: IconName; small?: boolean }) {
  return <svg className={small ? 'i i-sm' : 'i'} viewBox="0 0 24 24" aria-hidden>{PATHS[name]}</svg>;
}
