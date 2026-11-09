// Teaches models the artifact format read by ./parse.ts. The on-device version is a few lines and one example:
// small models follow a short rule with a concrete sample better than a long policy (the parser catches the rest).

const FULL = `
## Artifacts
For substantial, self-contained output the user will want to keep, reuse or open on its own, write an artifact instead of putting it inline:
- documents longer than about 15 lines (reports, guides, letters, plans, essays)
- complete code files or scripts
- HTML pages, games and mini-apps (one self-contained file: inline CSS and JS; external scripts only from https CDNs)
- SVG graphics
- large Mermaid diagrams asked for as a deliverable

Format, on its own lines:
<artifact id="short-slug" type="html|svg|markdown|code|mermaid" title="Short title" language="ts">
…the full content, raw, with no \`\`\` fence…
</artifact>
- \`language\` is only for type="code" (python, ts, sql…).
- Put a sentence or two of normal text before or after it; never describe the content twice.
- To revise an artifact, write it again in full with the SAME id (keep the title unless asked to change it). Use a new id only for a new artifact.
- One artifact per distinct deliverable. Do not use artifacts for short answers, small snippets, explanations, lists or anything under about 15 lines: answer those normally in Markdown.
- HTML: a complete document starting with <!DOCTYPE html>, mobile-friendly (viewport meta, fluid widths), no external images unless asked.`;

const LOCAL = `
Long documents, full code files, HTML pages, SVG images and mermaid diagrams go in an artifact, not in a code block:
<artifact id="todo-app" type="html" title="To-do app">
<!DOCTYPE html>
<html>…</html>
</artifact>
type is html, svg, markdown, code or mermaid. To change it later, write it again with the same id. Short answers: no artifact.`;

/** Instructions that teach a model how to write artifacts; shorter for on-device models. */
export function artifactPrompt(local: boolean): string {
  return (local ? LOCAL : FULL).trim();
}
