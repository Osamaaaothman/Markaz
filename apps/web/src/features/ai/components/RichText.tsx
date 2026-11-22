import { Fragment, type ReactNode } from "react";

// A deliberately tiny Markdown subset for model answers: paragraphs, "- " / "* " / "1. " lists,
// **bold**, and `code`. No HTML is ever interpreted (no dangerouslySetInnerHTML), so a model or a
// customer name cannot inject markup or scripts.
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    out.push(token.startsWith("**") ? <strong key={i++}>{token.slice(2, -2)}</strong> : <code key={i++}>{token.slice(1, -1)}</code>);
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text }: { text: string }): React.JSX.Element {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = (): void => {
    if (!list) return;
    const items = list.items.map((item, idx) => <li key={idx}>{inline(item)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet?.[1] !== undefined || numbered?.[1] !== undefined) {
      const ordered = numbered !== null;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet?.[1] ?? numbered?.[1]) as string);
      continue;
    }
    flush();
    if (line.trim() === "") continue;
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    blocks.push(heading?.[1] ? <p key={blocks.length} className="ai-rich__heading">{inline(heading[1])}</p> : <p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="ai-rich">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}
