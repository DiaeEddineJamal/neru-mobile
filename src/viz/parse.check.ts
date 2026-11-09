// Self-check for the visual fence parser and diagram layout: `node src/viz/parse.check.ts` (Node 22.18+ strips the types).
import assert from 'node:assert';

import { layoutFlow, measure } from './layout.ts';
import { chartCsv, formatTick, formatValue, looseJson, niceTicks, num, parseVisual } from './parse.ts';
import type { ChartSpec, FlowSpec, SequenceSpec, TimelineSpec, VisualSpec } from './parse.ts';

let cases = 0;
const ok = (lang: string, source: string): VisualSpec => {
  cases++;
  const r = parseVisual(lang, source);
  if (!r.ok) assert.fail(`expected ${lang} to parse: ${r.error}\n${source}`);
  return r.spec;
};
const bad = (lang: string, source: string, pattern: RegExp) => {
  cases++;
  const r = parseVisual(lang, source);
  assert.ok(!r.ok, `expected ${lang} to fail:\n${source}`);
  assert.match(r.error, pattern);
};
const chart = (lang: string, source: string) => {
  const s = ok(lang, source);
  assert.equal(s.kind, 'chart');
  return s as ChartSpec;
};

// 1. The desktop spec, exactly as the prompt teaches it.
const desk = chart('chart', '{"type":"bar","title":"Revenue","labels":["Q1","Q2","Q3"],"y":"USD","unit":"$","series":[{"name":"2025","data":[1,2,3]},{"name":"2026","data":[2,3,4]}]}');
assert.deepEqual(desk.labels, ['Q1', 'Q2', 'Q3']);
assert.equal(desk.series.length, 2);
assert.equal(desk.yLabel, 'USD');
assert.equal(desk.unit, '$');

// 2. The brief's spec: {x, y} points, axis objects, categories.
const brief = chart('chart', '{"type":"line","x":{"label":"Month"},"y":{"label":"Users","unit":"k"},"series":[{"name":"Web","data":[{"x":"Jan","y":3},{"x":"Feb","y":5}]},{"name":"App","data":[{"x":"Feb","y":4},{"x":"Mar","y":6}]}]}');
assert.deepEqual(brief.labels, ['Jan', 'Feb', 'Mar']);
assert.deepEqual(brief.series[1].values, [null, 4, 6]);
assert.equal(brief.xLabel, 'Month');
assert.equal(brief.unit, 'k');

// 3. Small-model JSON: comments, single quotes, unquoted keys, trailing commas, smart quotes.
const messy = chart('chart', `{
  // sales per region
  type: 'pie', title: “Sales”,
  labels: ['North', 'South', 'East',],
  series: [{name: 'Sales', data: [30, 50, 20,],},],
}`);
assert.equal(messy.type, 'pie');
assert.equal(messy.title, 'Sales');
assert.deepEqual(messy.series[0].values, [30, 50, 20]);

// 4. A bare array of numbers.
const bare = chart('chart', '[4, 8, 15, 16, 23, 42]');
assert.equal(bare.type, 'bar');
assert.deepEqual(bare.labels, ['1', '2', '3', '4', '5', '6']);

// 5. "label: value" lines, with bullets, units and a type line.
const lines = chart('chart', 'type: pie\n- Rent: 1,200\n- Food: 450\n- Fun: $80');
assert.equal(lines.type, 'pie');
assert.deepEqual(lines.labels, ['Rent', 'Food', 'Fun']);
assert.deepEqual(lines.series[0].values, [1200, 450, 80]);

// 6. Chart.js shape, numbers as strings, percentages.
const chartjs = chart('chart', '{"type":"doughnut","data":{"labels":["A","B"],"datasets":[{"label":"Share","data":["60%","40%"]}]}}');
assert.equal(chartjs.type, 'donut');
assert.equal(chartjs.unit, '%');
assert.deepEqual(chartjs.series[0].values, [60, 40]);

// 7. Row objects become one series per numeric field.
const rows = chart('chart', '{"type":"bar","stacked":true,"data":[{"month":"Jan","cost":3,"profit":1},{"month":"Feb","cost":4,"profit":2}]}');
assert.deepEqual(rows.labels, ['Jan', 'Feb']);
assert.deepEqual(rows.series.map(s => s.name), ['cost', 'profit']);
assert.equal(rows.stacked, true);

// 8. Truncated output (the model ran out of tokens) is closed and drawn.
const cut = chart('chart', '{"type":"line","labels":["a","b","c"],"series":[{"name":"x","data":[1,2,3]');
assert.deepEqual(cut.series[0].values, [1, 2, 3]);

// 9. Missing commas between objects and Python literals; scatter from pairs.
const scatter = chart('chart', `{"type": "scatter", "series": [{"name": "s", "data": [[1, 2] [2, 4] [3, NaN]]} {"name": "t", "data": [{"x": 1, "y": 1}]}], "stacked": True}`);
assert.equal(scatter.series.length, 2);
assert.deepEqual(scatter.series[0].points, [{ x: 1, y: 2 }, { x: 2, y: 4 }]);
assert.equal(scatter.stacked, false);

// 10. A map of label → value, inside a nested ```json fence.
const map = chart('chart', '```json\n{"title": "Votes", "data": {"Yes": 12, "No": 5}}\n```');
assert.deepEqual(map.labels, ['Yes', 'No']);

// 11. Pie built from several one-value series; non-positive slices dropped.
const slices = chart('chart', '{"type":"pie","series":[{"name":"A","data":[3]},{"name":"B","data":[0]},{"name":"C","data":[2]}]}');
assert.deepEqual(slices.labels, ['A', 'C']);

// 12. Unknown chart type falls back to bars when the data is fine.
assert.equal(chart('chart', '{"type":"radar chart","labels":["a"],"series":[{"name":"x","data":[1]}]}').type, 'bar');

// 13. Failures say why.
bad('chart', '{"type":"bar","title":"Nothing"}', /needs data/);
bad('chart', 'Here is a chart of the results that I made.', /JSON|label: value/);
bad('chart', '{"type":"pie","labels":["a"],"series":[{"name":"x","data":[-1]}]}', /positive/);
bad('chart', '{"series":[{"name":"x","data":["n/a","?"]}]}', /no numbers/);

// 14. Diagram JSON: flow with edges named by label, nodes as strings.
const flow = ok('diagram', '{"type":"flow","direction":"LR","nodes":[{"id":"a","label":"Start","kind":"start"},{"id":"b","label":"Check"},"Done"],"edges":[{"from":"a","to":"b"},{"from":"Check","to":"Done","label":"ok"}]}') as FlowSpec;
assert.equal(flow.direction, 'LR');
assert.deepEqual(flow.edges.map(e => `${e.from}>${e.to}`), ['a>b', 'b>Done']);
assert.equal(flow.nodes[0].kind, 'start');

// 15. Steps without edges become a chain; edges as "a -> b" strings.
assert.equal((ok('diagram', '{"nodes":["Plan","Build","Ship"]}') as FlowSpec).edges.length, 2);
assert.equal((ok('diagram', "{type: 'flow', edges: ['A -> B', 'B -> C: done']}") as FlowSpec).nodes.length, 3);

// 16. Nested tree.
const tree = ok('diagram', '{"type":"tree","root":{"label":"CEO","children":[{"label":"CTO","children":["Dev"]},{"label":"CFO"}]}}') as FlowSpec;
assert.equal(tree.type, 'tree');
assert.equal(tree.nodes.length, 4);
assert.equal(tree.edges.length, 3);

// 17. Sequence and timeline JSON, type inferred.
const seq = ok('diagram', '{"actors":["App","API"],"messages":[{"from":"App","to":"API","label":"GET /me"},{"from":"API","to":"App","label":"200","reply":true},["App","DB","read"]]}') as SequenceSpec;
assert.equal(seq.type, 'sequence');
assert.equal(seq.actors.length, 3);
assert.equal(seq.messages[1].reply, true);
const time = ok('diagram', '{"events":[{"date":"2019","label":"Founded"},{"year":2021,"title":"Series A","description":"$10M"}]}') as TimelineSpec;
assert.equal(time.events[1].date, '2021');
assert.equal(time.events[1].detail, '$10M');

// 18. Mermaid flowchart: shapes, labels on links, chains, &.
const mer = ok('mermaid', `flowchart TD
  %% a comment
  A([Start]) --> B{Cached?}
  B -->|yes| C[Return cached]
  B -- no --> D[(Fetch from DB)] --> C
  C & D --> E["Log <br> result"];
  classDef x fill:#f00`) as FlowSpec;
assert.deepEqual(mer.nodes.map(n => n.kind), ['start', 'decision', 'default', 'data', 'default']);
assert.equal(mer.nodes[4].label, 'Log result');
assert.equal(mer.edges.find(e => e.from === 'B' && e.to === 'C')?.label, 'yes');
assert.equal(mer.edges.find(e => e.from === 'B' && e.to === 'D')?.label, 'no');
assert.equal(mer.edges.length, 6);

// 19. Mermaid sequence, timeline and pie; unsupported kinds are reported.
const ms = ok('mermaid', 'sequenceDiagram\n  participant U as User\n  U->>S: login\n  S-->>U: token\n  Note over U: done') as SequenceSpec;
assert.deepEqual(ms.actors.map(a => a.label), ['User', 'S']);
assert.equal(ms.messages[1].reply, true);
const mt = ok('mermaid', 'timeline\n  title History\n  2004 : Facebook\n       : Google Maps\n  2005 : YouTube') as TimelineSpec;
assert.equal(mt.title, 'History');
assert.equal(mt.events[0].detail, 'Google Maps');
const mp = ok('mermaid', 'pie title Pets\n  "Dogs" : 386\n  "Cats" : 85') as ChartSpec;
assert.equal(mp.type, 'pie');
assert.deepEqual(mp.labels, ['Dogs', 'Cats']);
bad('mermaid', 'gantt\n  title A', /not drawn here/);
// A ```diagram fence holding Mermaid works too.
assert.equal(ok('diagram', 'graph LR\n a-->b').kind, 'diagram');
bad('diagram', '{"type":"flow"}', /needs "nodes"/);

// Loose JSON and numbers.
assert.deepEqual(looseJson("{a: 'it\\'s', b: [1, 2,], c: undefined}"), { a: "it's", b: [1, 2], c: null });
assert.deepEqual(looseJson('{"title": Sales by month, "n": 2}'), { title: 'Sales by month', n: 2 });
assert.equal(num('1,234.5'), 1234.5);
assert.equal(num('12.5k'), 12500);
assert.equal(num('3,5'), 3.5);
assert.equal(num('abc'), null);
assert.deepEqual(niceTicks(0, 87), [0, 25, 50, 75, 100]);
assert.equal(formatValue(-12, '$'), '-$12');
assert.equal(formatValue(45, '%'), '45%');
assert.ok(/12(\.3)?K/i.test(formatTick(12_345)), formatTick(12_345));
assert.equal(chartCsv(desk), 'label,2025,2026\nQ1,1,2\nQ2,2,3\nQ3,3,4');

// Layout: ranks follow edges, cycles still lay out, nothing overlaps within a rank.
const laid = layoutFlow(mer);
const byId = new Map(laid.boxes.map(b => [b.id, b]));
assert.ok(byId.get('A')!.rank < byId.get('B')!.rank && byId.get('B')!.rank < byId.get('D')!.rank && byId.get('D')!.rank < byId.get('C')!.rank);
const loop = layoutFlow({ kind: 'diagram', type: 'flow', direction: 'TB', nodes: ['a', 'b', 'c'].map(id => ({ id, label: id, kind: 'default' as const })), edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }] });
assert.deepEqual(loop.boxes.map(b => b.rank), [0, 1, 2]);
assert.equal(loop.links.length, 3);
for (const b of laid.boxes) for (const o of laid.boxes) if (b !== o && b.rank === o.rank) assert.ok(b.x + b.w <= o.x || o.x + o.w <= b.x, `${b.id} overlaps ${o.id}`);
assert.ok(laid.width > 0 && laid.height > 0);
assert.equal(measure('A rather long label that needs wrapping onto lines').lines > 1, true);

console.log(`viz parse ok: ${cases} fence cases + loose JSON, numbers, ticks, CSV and layout checks passed`);
