// The new-chat greeting: short, casual, matched to the hour (and a few days of the week), with the user's
// first name when Neru knows it. Lines stay short enough for the big serif headline on a phone.
type Line = (n: string) => string; // n: ", Sam" or ""

const pools: { hours: [number, number]; lines: Line[] }[] = [
  { hours: [0, 5], lines: [n => `Up late${n}?`, n => `Night owl mode${n}`, n => `Still awake${n}?`, () => 'The quiet hours', n => `Can’t sleep${n}?`, () => 'Midnight thoughts?'] },
  { hours: [5, 8], lines: [n => `Early start${n}`, n => `Rise and shine${n}`, n => `Up with the sun${n}`, () => 'Fresh day, fresh ideas', n => `Coffee first${n}?`] },
  { hours: [8, 12], lines: [n => `Good morning${n}`, n => `Morning${n}`, n => `Morning${n}, what’s first?`, () => 'Let’s get going', n => `Hey${n}, fresh start`, () => 'Ready when you are'] },
  { hours: [12, 14], lines: [n => `Lunch break${n}?`, n => `Midday${n}`, n => `Hey${n}, halfway there`, () => 'Fuel up, then dive in', n => `Good afternoon${n}`] },
  { hours: [14, 18], lines: [n => `Good afternoon${n}`, n => `Afternoon${n}`, () => 'Second wind?', n => `Hey${n}, what’s next?`, () => 'Let’s keep it rolling', n => `Still going strong${n}?`] },
  { hours: [18, 22], lines: [n => `Good evening${n}`, n => `Evening${n}`, n => `Winding down${n}?`, () => 'One more idea?', n => `Hey${n}, how was today?`, () => 'Evening thinking time'] },
  { hours: [22, 24], lines: [n => `Late one${n}?`, n => `Night${n}`, () => 'Burning the midnight oil?', n => `Still at it${n}?`, () => 'One last thing?'] },
];

const days: Record<number, Line[]> = {
  1: [n => `New week${n}`, () => 'Monday, let’s do this'],
  5: [n => `Happy Friday${n}`, () => 'Friday mode on'],
  6: [n => `Happy Saturday${n}`, () => 'Weekend ideas?'],
  0: [n => `Lazy Sunday${n}?`, () => 'Sunday thinking'],
};

let last = '';

/** A fresh greeting for a new chat, never the same line twice in a row. */
export function greeting(name?: string, now = new Date()) {
  const first = name?.trim().split(/\s+/)[0];
  const n = first ? `, ${first}` : '';
  const h = now.getHours();
  const pool = pools.find(p => h >= p.hours[0] && h < p.hours[1])!.lines;
  // Day-of-week lines join the mix during the day, not in the small hours.
  const extra = h >= 7 && h < 22 ? days[now.getDay()] ?? [] : [];
  const options = [...pool, ...extra].map(l => l(n)).filter(l => l !== last);
  last = options[Math.floor(Math.random() * options.length)];
  return last;
}
