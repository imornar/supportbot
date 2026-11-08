export const CHUNK_TARGET_CHARS = 1200;
export const CHUNK_OVERLAP_CHARS = 150;

const minSentenceBoundary = Math.floor(CHUNK_TARGET_CHARS / 2);

export type DocumentChunk = {
  index: number;
  section: string | null;
  text: string;
};

export function chunkDocument(
  documentType: "markdown" | "text",
  content: string,
): DocumentChunk[] {
  const sections =
    documentType === "markdown"
      ? splitMarkdown(content)
      : [{ section: null, body: content }];
  const drafts: Array<Omit<DocumentChunk, "index">> = [];
  for (const section of sections) {
    drafts.push(...packSection(section.section, section.body));
  }
  return drafts.map((draft, index) => ({ ...draft, index }));
}

function splitMarkdown(
  content: string,
): Array<{ section: string | null; body: string }> {
  const lines = content.split("\n");
  const sections: Array<{ section: string | null; lines: string[] }> = [
    { section: null, lines: [] },
  ];
  const stack: Array<{ level: number; text: string }> = [];
  let fence: "`" | "~" | null = null;

  for (const line of lines) {
    const fenceMarker = fenceMarkerAt(line);
    if (fenceMarker) {
      if (!fence) {
        fence = fenceMarker;
      } else if (fenceMarker === fence) {
        fence = null;
      }
      sections[sections.length - 1]?.lines.push(line);
      continue;
    }
    if (!fence) {
      const heading = /^(#{1,3})[ \t]+(\S.*?)\s*$/.exec(line);
      if (heading?.[1] && heading[2]) {
        const level = heading[1].length;
        const text = heading[2].trim().slice(0, 180);
        while (stack.length > 0 && stack[stack.length - 1]!.level >= level) {
          stack.pop();
        }
        stack.push({ level, text });
        sections.push({
          section: stack
            .map((item) => item.text)
            .join(" / ")
            .slice(0, 500),
          lines: [],
        });
        continue;
      }
    }
    sections[sections.length - 1]?.lines.push(line);
  }

  return sections
    .map((section) => ({
      section: section.section,
      body: section.lines.join("\n"),
    }))
    .filter((section) => section.body.trim().length > 0);
}

function fenceMarkerAt(line: string): "`" | "~" | null {
  if (/^`{3,}/.test(line)) {
    return "`";
  }
  if (/^~{3,}/.test(line)) {
    return "~";
  }
  return null;
}

function packSection(
  section: string | null,
  body: string,
): Array<Omit<DocumentChunk, "index">> {
  const paragraphs = body
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  const drafts: Array<Omit<DocumentChunk, "index">> = [];
  let current = "";

  const flush = () => {
    if (current.length > 0) {
      drafts.push({ section, text: current });
      current = "";
    }
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_TARGET_CHARS) {
      flush();
      for (const piece of splitLongParagraph(paragraph)) {
        drafts.push({ section, text: piece });
      }
      continue;
    }
    const candidate =
      current.length > 0 ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= CHUNK_TARGET_CHARS) {
      current = candidate;
    } else {
      flush();
      current = paragraph;
    }
  }
  flush();
  return drafts;
}

function splitLongParagraph(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    if (text.length - start <= CHUNK_TARGET_CHARS) {
      const tail = text.slice(start).trim();
      if (tail.length > 0) {
        parts.push(tail);
      }
      break;
    }
    let end = start + CHUNK_TARGET_CHARS;
    const boundary = lastSentenceEnd(text.slice(start, end));
    if (boundary >= minSentenceBoundary) {
      end = start + boundary;
    }
    const piece = text.slice(start, end).trim();
    if (piece.length === 0) {
      start += 1;
      continue;
    }
    parts.push(piece);
    const next = end - CHUNK_OVERLAP_CHARS;
    start = next > start ? next : end;
  }
  return parts;
}

function lastSentenceEnd(window: string): number {
  let best = -1;
  for (const mark of [". ", "! ", "? ", ".\n", "!\n", "?\n"]) {
    const at = window.lastIndexOf(mark);
    if (at >= 0 && at + mark.length > best) {
      best = at + mark.length;
    }
  }
  return best;
}
