// The new-chat greeting: short, casual, matched to the hour (and a few days of the week), with the user's
// first name when Neru knows it. Lines stay short enough for the big serif headline on a phone.
// Each line is a translation key; {n} becomes ", Sam" or "" (French and Spanish put it in the same place).
type Line = string;

const pools: { hours: [number, number]; lines: Line[] }[] = [
  { hours: [0, 5], lines: ['Up late{n}?', 'Night owl mode{n}', 'Still awake{n}?', 'The quiet hours', 'Can’t sleep{n}?', 'Midnight thoughts?'] },
  { hours: [5, 8], lines: ['Early start{n}', 'Rise and shine{n}', 'Up with the sun{n}', 'Fresh day, fresh ideas', 'Coffee first{n}?'] },
  { hours: [8, 12], lines: ['Good morning{n}', 'Morning{n}', 'Morning{n}, what’s first?', 'Let’s get going', 'Hey{n}, fresh start', 'Ready when you are'] },
  { hours: [12, 14], lines: ['Lunch break{n}?', 'Midday{n}', 'Hey{n}, halfway there', 'Fuel up, then dive in', 'Good afternoon{n}'] },
  { hours: [14, 18], lines: ['Good afternoon{n}', 'Afternoon{n}', 'Second wind?', 'Hey{n}, what’s next?', 'Let’s keep it rolling', 'Still going strong{n}?'] },
  { hours: [18, 22], lines: ['Good evening{n}', 'Evening{n}', 'Winding down{n}?', 'One more idea?', 'Hey{n}, how was today?', 'Evening thinking time'] },
  { hours: [22, 24], lines: ['Late one{n}?', 'Night{n}', 'Burning the midnight oil?', 'Still at it{n}?', 'One last thing?'] },
];

const days: Record<number, Line[]> = {
  1: ['New week{n}', 'Monday, let’s do this'],
  5: ['Happy Friday{n}', 'Friday mode on'],
  6: ['Happy Saturday{n}', 'Weekend ideas?'],
  0: ['Lazy Sunday{n}?', 'Sunday thinking'],
};

let last = '';

type Translate = (key: string, vars: Record<string, string>) => string;
const english: Translate = (key, vars) => key.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');

/** A fresh greeting for a new chat, never the same line twice in a row. Pass `t` from '@/i18n' to translate. */
export function greeting(name?: string, now = new Date(), t: Translate = english) {
  const first = name?.trim().split(/\s+/)[0];
  const n = first ? `, ${first}` : '';
  const h = now.getHours();
  const pool = pools.find(p => h >= p.hours[0] && h < p.hours[1])!.lines;
  // Day-of-week lines join the mix during the day, not in the small hours.
  const extra = h >= 7 && h < 22 ? days[now.getDay()] ?? [] : [];
  const options = [...pool, ...extra].map(l => t(l, { n })).filter(l => l !== last);
  last = options[Math.floor(Math.random() * options.length)];
  return last;
}
