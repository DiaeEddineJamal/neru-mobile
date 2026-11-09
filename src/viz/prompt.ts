// Teaches a model the visual fences. The chart spec and the ```mermaid diagrams are the ones the desktop app
// draws, so a conversation looks the same on both. On-device models get one tiny example: their context is small.

const FULL = `## Inline charts and diagrams
The app draws two kinds of fenced blocks as interactive visuals. Use one only when a picture genuinely helps: comparing quantities, a trend over time, parts of a whole, a process or decision flow, an exchange between systems, or a timeline. Most answers need none; never add one for decoration. Keep the explanation in prose around it, at most one or two visuals per answer.

Charts: a \`\`\`chart block holding one JSON object. It must be valid JSON: double quotes, no comments, no trailing commas.
- "type": "bar", "line", "area", "pie" or "scatter"
- "labels": the categories, in order (x axis, or pie slices)
- "series": [{"name": "...", "data": [one number per label]}]; for scatter, "data" is [[x, y], ...]
- optional: "title", "x" (x-axis title), "y" (y-axis title), "unit" ("%", "$", "ms"...), "stacked": true (bar or area)
\`\`\`chart
{"type": "bar", "title": "Revenue by quarter", "labels": ["Q1", "Q2", "Q3", "Q4"], "y": "Revenue", "unit": "$", "series": [{"name": "2025", "data": [120, 135, 150, 170]}, {"name": "2026", "data": [140, 160, 155, 190]}]}
\`\`\`

Diagrams: a \`\`\`mermaid block. Only flowchart (graph TD or LR), sequenceDiagram, timeline and pie are drawn; keep labels short and stay under about 15 nodes.
\`\`\`mermaid
flowchart TD
  A[Request] --> B{In cache?}
  B -->|yes| C[Return cached copy]
  B -->|no| D[Fetch from origin] --> C
\`\`\`

Use numbers from the conversation, its files or well-established facts. Never invent data; if values are estimates, say so in the text.`;

const LOCAL = `To show numbers as a chart (only when it really helps), write a \`\`\`chart block with valid JSON, type "bar", "line" or "pie":
\`\`\`chart
{"type": "bar", "labels": ["A", "B", "C"], "series": [{"name": "Sales", "data": [3, 5, 2]}]}
\`\`\``;

/** Instructions that teach a model how to emit inline charts and diagrams; shorter for on-device models. */
export function visualPrompt(local: boolean): string {
  return local ? LOCAL : FULL;
}
