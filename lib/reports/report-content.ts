export type ReportInlineSegment =
  | { type: "text"; value: string }
  | { type: "strong"; value: string }
  | { type: "emphasis"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; value: string; href: string };

export type ReportContentBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "metadata"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "unordered-list"; items: string[] }
  | { type: "ordered-list"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "code"; text: string }
  | { type: "divider" }
  | { type: "table"; headers: string[]; rows: string[][] };

const REPORT_SECTION_HEADINGS = new Set([
  "Burden Trend",
  "Diagnostic Snapshot",
  "Priority Findings",
  "New Violations",
  "Open Challenges",
  "Coaching Program",
  "Compliance Sweep",
]);

const INLINE_PATTERN =
  /(\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^)\s]+\)|\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g;

function inlineToken(token: string): ReportInlineSegment {
  const link = token.match(/^\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)$/);
  if (link) {
    return { type: "link", value: link[1], href: link[2] };
  }
  if (token.startsWith("**") && token.endsWith("**")) {
    return { type: "strong", value: token.slice(2, -2) };
  }
  if (token.startsWith("`") && token.endsWith("`")) {
    return { type: "code", value: token.slice(1, -1) };
  }
  if (token.startsWith("*") && token.endsWith("*")) {
    return { type: "emphasis", value: token.slice(1, -1) };
  }
  return { type: "text", value: token };
}

export function parseReportInline(text: string): ReportInlineSegment[] {
  const segments: ReportInlineSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, index) });
    }
    segments.push(inlineToken(match[0]));
    cursor = index + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }
  return segments.length > 0 ? segments : [{ type: "text", value: text }];
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = tableCells(line);
  return (
    cells.length > 1 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell))
  );
}

export function parseReportContent(content: string): ReportContentBlock[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReportContentBlock[] = [];
  let paragraph: string[] = [];
  let firstContentBlock = true;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join("\n").trim();
    if (text) {
      if (firstContentBlock) {
        blocks.push({ type: "heading", level: 1, text });
        firstContentBlock = false;
      } else if (/^Report date:/i.test(text)) {
        blocks.push({ type: "metadata", text });
      } else {
        blocks.push({ type: "paragraph", text });
      }
    }
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2].trim(),
      });
      firstContentBlock = false;
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      blocks.push({ type: "divider" });
      firstContentBlock = false;
      continue;
    }

    if (trimmed.startsWith("```")) {
      flushParagraph();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: "code", text: code.join("\n") });
      firstContentBlock = false;
      continue;
    }

    if (
      trimmed.includes("|") &&
      index + 1 < lines.length &&
      isTableSeparator(lines[index + 1])
    ) {
      flushParagraph();
      const headers = tableCells(trimmed);
      const rows: string[][] = [];
      index += 2;
      while (
        index < lines.length &&
        lines[index].trim() &&
        lines[index].includes("|")
      ) {
        const cells = tableCells(lines[index]);
        rows.push(
          headers.map((_, cellIndex) => cells[cellIndex] ?? "")
        );
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "table", headers, rows });
      firstContentBlock = false;
      continue;
    }

    const unorderedItem = trimmed.match(/^[-*+]\s+(.+)$/);
    if (unorderedItem) {
      flushParagraph();
      const items = [unorderedItem[1]];
      while (index + 1 < lines.length) {
        const next = lines[index + 1].trim().match(/^[-*+]\s+(.+)$/);
        if (!next) break;
        items.push(next[1]);
        index += 1;
      }
      blocks.push({ type: "unordered-list", items });
      firstContentBlock = false;
      continue;
    }

    const orderedItem = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (orderedItem) {
      flushParagraph();
      const items = [orderedItem[1]];
      while (index + 1 < lines.length) {
        const next = lines[index + 1].trim().match(/^\d+[.)]\s+(.+)$/);
        if (!next) break;
        items.push(next[1]);
        index += 1;
      }
      blocks.push({ type: "ordered-list", items });
      firstContentBlock = false;
      continue;
    }

    if (trimmed.startsWith("> ")) {
      flushParagraph();
      const quote = [trimmed.slice(2)];
      while (index + 1 < lines.length && lines[index + 1].trim().startsWith("> ")) {
        quote.push(lines[index + 1].trim().slice(2));
        index += 1;
      }
      blocks.push({ type: "quote", text: quote.join("\n") });
      firstContentBlock = false;
      continue;
    }

    if (REPORT_SECTION_HEADINGS.has(trimmed)) {
      flushParagraph();
      blocks.push({ type: "heading", level: 2, text: trimmed });
      firstContentBlock = false;
      continue;
    }

    if (/^Report date:/i.test(trimmed)) {
      flushParagraph();
      blocks.push({ type: "metadata", text: trimmed });
      firstContentBlock = false;
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}
