import Link from "next/link";
import { DBS_FILES, loadDbs } from "@/lib/arena/rulesets";
import { leadingComment, printedByFile } from "@/lib/arena/rulesets/print-by-file";

export const metadata = { title: "The game, as files" };

/** The docs table's own order (`docs/arena-ruleset-spec.md` §3) — setup and the board first, then the moves that play it. */
const FILE_ORDER = ["game.rules", "attributes.rules", "zones.rules", "ops.rules", "triggers.rules", "keywords.rules", "actions.rules", "costs.rules", "battle.rules"];

/**
 * The game itself, written in files nobody outside the codebase could see —
 * so the owner correcting a card in the workbench can read the rules it is
 * checked against, in the same language, beside it (issue #163).
 *
 * Every declaration shown here is printed by `lang/print.ts` from what the
 * loader actually parsed, never the raw `.rules` text: what you read is what
 * plays. Each file's own leading comment — the manual sections and the
 * narrative `docs/arena-ruleset-spec.md` cites line by line — is shown
 * beside it as a note, since the language has no comment of its own for the
 * printer to keep.
 */
export default function RulesGamePage() {
  const loaded = loadDbs();
  if (!loaded.ok) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold tracking-tight text-space-50">The game, as files</h1>
        <p className="rounded-xl border border-loss/40 bg-loss/10 p-4 text-sm text-loss">The DBS ruleset does not load: {JSON.stringify(loaded.errors[0])}</p>
      </div>
    );
  }
  const grouped = printedByFile(loaded.definition);
  const byFile = new Map(grouped.map((g) => [g.file, g]));
  const order = [...FILE_ORDER.filter((f) => byFile.has(f)), ...[...byFile.keys()].filter((f) => !FILE_ORDER.includes(f))];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-semibold tracking-tight text-space-50">The game, as files</h1>
        <Link href="/arena/rules" className="ml-auto text-xs text-space-300 hover:text-ki-300">
          ← The rules of your cards
        </Link>
      </div>
      <p className="text-sm text-space-300">
        Dragon Ball Super, as the rules engine (beta) reads it — one section per <span className="font-mono text-[11px]">.rules</span> file, printed from what was actually parsed rather than the raw
        text. Read-only: editing the definition itself is a decision the owner has not made yet. The keyword bodies are on{" "}
        <Link href="/arena/rules/keywords" className="text-ki-300 hover:underline">
          their own page
        </Link>
        .
      </p>

      <nav className="flex flex-wrap gap-1.5 text-[11px]">
        {order.map((file) => (
          <a key={file} href={`#file-${file}`} className="tap rounded-md bg-space-900 px-2.5 py-1.5 text-space-300 hover:text-ki-300">
            {file} ({byFile.get(file)!.declarations.length})
          </a>
        ))}
      </nav>

      {order.map((file) => {
        const note = leadingComment(DBS_FILES[file] ?? "");
        const g = byFile.get(file)!;
        return (
          <section key={file} id={`file-${file}`} className="scroll-mt-4 space-y-3">
            <h2 className="font-mono text-sm font-medium text-space-100">{file}</h2>
            {note && <p className="whitespace-pre-wrap rounded-xl border border-space-800 bg-space-950/60 p-3 text-[12px] leading-relaxed text-space-400">{note}</p>}
            <ul className="space-y-2">
              {g.declarations.map((d) => (
                <li key={d.id} id={d.id} className="scroll-mt-4 rounded-xl border border-space-700/70 bg-space-900/50 p-3">
                  <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-space-200">{d.text}</pre>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
