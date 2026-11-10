// Teaches models the artifact format read by ./parse.ts. The on-device version is a few lines and one example:
// small models follow a short rule with a concrete sample better than a long policy (the parser catches the rest).
// Files (Word, PDF, PowerPoint, Excel) are artifacts too: the model writes Markdown or CSV and the app builds the real
// file (office.ts, share.ts), so models must never claim they cannot make files.

const FULL = `
## Artifacts
For substantial, self-contained output the user will want to keep, reuse or open on its own, write an artifact instead of putting it inline:
- documents longer than about 15 lines (reports, guides, letters, plans, essays)
- complete code files or scripts
- HTML pages, games and mini-apps (one self-contained file: inline CSS and JS; external scripts only from https CDNs)
- SVG graphics
- large Mermaid diagrams asked for as a deliverable

Format, on its own lines:
<artifact id="short-slug" type="html|svg|markdown|code|mermaid|docx|pdf|pptx|xlsx" title="Short title" language="ts">
…the full content, raw, with no \`\`\` fence…
</artifact>
- \`language\` is only for type="code" (python, ts, sql…).
- Put a sentence or two of normal text before or after it; never describe the content twice.
- To revise an artifact, write it again in full with the SAME id (keep the title unless asked to change it). Use a new id only for a new artifact.
- One artifact per distinct deliverable. Do not use artifacts for short answers, small snippets, explanations, lists or anything under about 15 lines: answer those normally in Markdown.
- HTML: a complete document starting with <!DOCTYPE html>, mobile-friendly (viewport meta, fluid widths), no external images unless asked.

## Files: Word, PDF, PowerPoint, Excel
You CAN create real files. This app turns these artifacts into genuine .docx, .pdf, .pptx and .xlsx files that the user opens, downloads and shares from the artifact page. Never say you cannot create files, never offer an empty or placeholder file, and never tell the user to copy text into Word themselves. Whenever the user asks for a Word document, a PDF, a presentation/slides/deck, or a spreadsheet/Excel/CSV (or for something usually delivered as one: a CV, cover letter, contract, invoice, report, budget, schedule, pitch deck…), write the complete content in one of these artifacts:
- Word: type="docx". Content in Markdown: start with "# Title", then ## sections, paragraphs, bullet or numbered lists, tables, **bold**, *italic*, links.
- PDF: type="pdf". Same Markdown as Word.
- PowerPoint: type="pptx". Markdown slides separated by a line holding only ---. Each slide starts with "# Slide title", then 3–6 short bullet points (indent sub-points by 2 spaces), a short paragraph or a Markdown table. The first slide is the title slide: "# Title" and one subtitle line. Aim for 6–12 slides unless asked otherwise.
- Excel: type="xlsx". One Markdown table per sheet, each under a "## Sheet name" heading; the first row is the header. Plain numbers (no units inside number cells). A cell starting with = is a formula in Excel syntax with A1 references, counting the header as row 1 (so the first data row is row 2), e.g. =SUM(B2:B10) or =B2*C2.
Write real, finished content (no "lorem ipsum", no "[add text here]" unless the user must fill in personal details). After the artifact, say in one sentence that the file is ready to open or share from the artifact.`;

const LOCAL = `
Long documents, full code files, HTML pages, SVG images and mermaid diagrams go in an artifact, not in a code block:
<artifact id="todo-app" type="html" title="To-do app">
<!DOCTYPE html>
<html>…</html>
</artifact>
type is html, svg, markdown, code or mermaid. To change it later, write it again with the same id. Short answers: no artifact.
You can make real files: the app converts these artifacts. Word: type="docx" and PDF: type="pdf" (Markdown). PowerPoint: type="pptx" (slides split by a line ---, each starting "# Title" then bullets). Excel: type="xlsx" (a Markdown table). Never say you cannot create files.`;

/** Instructions that teach a model how to write artifacts; shorter for on-device models. */
export function artifactPrompt(local: boolean): string {
  return (local ? LOCAL : FULL).trim();
}
