import { Fragment } from "react";

/**
 * Card text from the catalog: lines split by <br>, keywords in [brackets],
 * card names in {braces}, traits in <angle brackets> (HTML-escaped as &lt; &gt;).
 */
export function SkillText({ text }: { text: string }) {
  const lines = text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .split(/<br\s*\/?>/i)
    .map((l) => l.trim())
    .filter(Boolean);
  return (
    <div className="space-y-1">
      {lines.map((line, i) => (
        <p key={i}>{renderInline(line)}</p>
      ))}
    </div>
  );
}

function renderInline(line: string) {
  const parts = line.split(/(\[[^\]]+\]|\{[^}]+\}|<[^>]+>)/g);
  return parts.map((p, i) => {
    if (/^\[[^\]]+\]$/.test(p))
      return (
        <span key={i} className="mx-px rounded bg-ki-500/15 px-1 text-[0.9em] font-semibold text-ki-300">
          {p.slice(1, -1)}
        </span>
      );
    if (/^\{[^}]+\}$/.test(p))
      return (
        <span key={i} className="font-medium text-space-50">
          {p.slice(1, -1)}
        </span>
      );
    if (/^<[^>]+>$/.test(p))
      return (
        <span key={i} className="text-blue-200">
          ‹{p.slice(1, -1)}›
        </span>
      );
    return <Fragment key={i}>{p}</Fragment>;
  });
}
