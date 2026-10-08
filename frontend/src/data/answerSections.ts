/**
 * ANSWER SECTIONS (presentation law): engine answer prose is STRUCTURED text — labelled
 * sections in either of the two forms the engine emits:
 *
 *   "**What happened:** value..."   (label carries the value on its own line)
 *   "**What happened**"             (own-line heading; the following lines are its body)
 *
 * The trader must see real section headings and readable paragraphs, never literal Markdown
 * asterisks and never a raw JSON payload dumped as prose. This module parses the string into
 * sections ONCE, purely and DOM-free, so every surface renders the same hierarchy.
 *
 * Display-only normalization: `**` markers are markup, not content, and are removed. Nothing
 * inside a section is reworded, summarized or dropped — the text is shown verbatim apart
 * from the markers, so evidence integrity is untouched by presentation.
 */

export interface AnswerSection {
  /** The section's own heading (e.g. "What happened"); undefined for a leading preamble. */
  readonly heading?: string;
  /** Body paragraphs of the section (newline groups), verbatim apart from `**` removal. */
  readonly body: readonly string[];
}

/** A `**Heading**` / `**Heading:**` line, with an optional value that starts on the line. */
const HEADING_LINE = /^\*\*([^*]{1,80})\*\*\s*:?\s*(.*)$/;

/** Strip the bold marker pair wherever it appears (markup removal, never content edits). */
function stripMarkers(text: string): string {
  return text.replace(/\*\*/g, "");
}

/**
 * Parse engine answer prose into ordered sections. Both heading styles are recognized; lines
 * before the first heading form an unnamed preamble section. Consecutive body lines stay in
 * the section whose heading they follow — the "own-line heading" form used to render its body
 * as unlabeled loose lines under a bare heading.
 */
export function parseAnswerSections(text: string): readonly AnswerSection[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const sections: { heading?: string; body: string[] }[] = [];
  let breakPending = false;
  const pushBody = (line: string): void => {
    const current = sections[sections.length - 1];
    if (current === undefined) {
      sections.push({ body: [line] });
      breakPending = false;
      return;
    }
    // A blank line separates paragraphs inside the same section.
    if (breakPending && current.body.length > 0) current.body.push(line);
    else if (current.body.length > 0) current.body[current.body.length - 1] = `${current.body[current.body.length - 1]} ${line}`;
    else current.body.push(line);
    breakPending = false;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) {
      breakPending = true;
      continue;
    }
    const match = HEADING_LINE.exec(line);
    if (match !== null && match[1] !== undefined) {
      const heading = stripMarkers(match[1].trim().replace(/[:\s]+$/, ""));
      const value = stripMarkers((match[2] ?? "").trim());
      sections.push({
        ...(heading.length > 0 ? { heading } : {}),
        body: value.length > 0 ? [value] : [],
      });
      breakPending = false;
      continue;
    }
    pushBody(stripMarkers(line));
  }
  return sections.map((s) => ({ ...s, body: s.body }));
}

/** Preview/full pair for progressive disclosure of long content (never mutates the source). */
export interface CondensedText {
  readonly preview: string;
  readonly full: string;
  readonly truncated: boolean;
}

/**
 * Condense a long text for display: a bounded preview plus the untouched full text the
 * "inspect" disclosure expands. A hard limit here is what keeps a multi-KB payload from
 * becoming a wall of prose in the read path.
 */
export function condenseText(text: string, limit: number): CondensedText {
  if (text.length <= limit) return { preview: text, full: text, truncated: false };
  let cut = text.lastIndexOf(" ", limit);
  if (cut < Math.floor(limit * 0.6)) cut = limit;
  return { preview: `${text.slice(0, cut).trimEnd()}…`, full: text, truncated: true };
}

/**
 * Does this text look like a raw transport payload (JSON object/array) rather than prose?
 * Used to render such evidence in a monospace, collapsed "raw" block instead of as a
 * paragraph pretending to be readable content.
 */
export function looksLikePayload(text: string): boolean {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return true;
  return /^\s*"[^"\n]+"\s*:/m.test(text);
}
