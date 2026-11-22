import { Fragment, type ReactNode } from "react";

// A deliberately small Markdown subset for model answers: paragraphs, headings, "- " / "1. " lists,
// **bold**, `code`, and pipe tables (| a | b |). No HTML is ever interpreted (no dangerouslySetInnerHTML),
// so a model or a customer name cannot inject markup or scripts.
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|(?<![\w*])\*[^*\s][^*]*\*(?![\w*]))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    out.push(token.startsWith("**") ? <strong key={i++}>{token.slice(2, -2)}</strong> : token.startsWith("`") ? <code key={i++}>{token.slice(1, -1)}</code> : <em key={i++}>{token.slice(1, -1)}</em>);
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableRow = (line: string): boolean => /^\s*\|.*\|\s*$/.test(line);
const isDivider = (line: string): boolean => /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(line);
const cells = (line: string): string[] => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
// A cell that is only a number (with thousands separators, sign, decimals or %) is right-aligned and LTR.
const NUMERIC = /^\(?[-+]?[\d,]+(\.\d+)?\)?%?$/;

function Table({ rows }: { rows: string[] }): React.JSX.Element {
  const [head, ...rest] = rows;
  const body = rest.filter((r) => !isDivider(r)).map(cells);
  const header = head ? cells(head) : [];
  return (
    <div className="ai-table-wrap ai-rich__table">
      <table className="ai-table">
        <thead><tr>{header.map((h, i) => <th key={i}>{inline(h)}</th>)}</tr></thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri} style={{ animationDelay: `${ri * 35}ms` }}>
              {header.map((_, ci) => {
                const value = r[ci] ?? "";
                return <td key={ci} className={NUMERIC.test(value.replace(/\s/g, "")) ? "ai-table__num" : undefined}>{inline(value)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RichText({ text }: { text: string }): React.JSX.Element {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  // `start` keeps the model's own numbering when a list is broken by a line in between ("1." … text … "2.").
  let list: { ordered: boolean; start: number; items: string[] } | null = null;
  let table: string[] | null = null;
  const flushList = (): void => {
    if (!list) return;
    const items = list.items.map((item, idx) => <li key={idx}>{item.split("\n").map((part, pi) => <Fragment key={pi}>{pi > 0 ? <br /> : null}{inline(part)}</Fragment>)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length} start={list.start}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  const flushTable = (): void => {
    if (!table) return;
    // A single "| x |" line without a header divider is just text.
    if (table.length >= 2 && table[1] !== undefined && isDivider(table[1])) blocks.push(<Table key={blocks.length} rows={table} />);
    else table.forEach((row) => blocks.push(<p key={blocks.length}>{inline(row)}</p>));
    table = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (isTableRow(line)) {
      flushList();
      table ??= [];
      table.push(line);
      continue;
    }
    flushTable();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    // An indented line under a list item (a detail, a sub-bullet) belongs to that item, so the list —
    // and its numbering — is not broken into several lists that each restart at 1.
    if (list && /^\s{2,}\S/.test(line) && numbered === null) {
      const last = list.items.length - 1;
      list.items[last] = `${list.items[last] ?? ""}\n${bullet?.[1] !== undefined ? `• ${bullet[1]}` : line.trim()}`;
      continue;
    }
    if (bullet?.[1] !== undefined || numbered?.[2] !== undefined) {
      const ordered = numbered !== null;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, start: numbered ? Number(numbered[1]) : 1, items: [] };
      list.items.push((bullet?.[1] ?? numbered?.[2]) as string);
      continue;
    }
    // A blank line between items keeps the list open ("1." blank "2." is one list).
    if (line.trim() === "") continue;
    flushList();
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    blocks.push(heading?.[1] ? <p key={blocks.length} className="ai-rich__heading">{inline(heading[1])}</p> : <p key={blocks.length}>{inline(line)}</p>);
  }
  flushTable();
  flushList();
  return <div className="ai-rich">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}
