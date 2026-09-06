import Link from "next/link";
import { KEYWORDS, MODIFIERS, READING_RULES, SKILL_TYPES, SUPPORT_LABEL, keywordsByGroup, type Support } from "@/lib/arena/glossary";

export const metadata = { title: "Keywords the engine knows" };

const SUPPORT_CLASS: Record<Support, string> = {
  engine: "bg-gain/15 text-gain",
  partial: "bg-dbs-yellow/20 text-dbs-yellow",
  deck: "bg-space-800 text-space-300",
};

/**
 * Every keyword the arena's parser recognises, what the rule means, and what
 * this engine does with it — the second of those being the part you cannot
 * read off a card.
 *
 * All of it comes from `src/lib/arena/glossary.ts`, which is keyed by the
 * engine's own keyword union, so this page cannot fall behind the parser
 * without the build saying so.
 */
export default function KeywordsPage() {
  const groups = keywordsByGroup();
  const total = Object.keys(KEYWORDS).length;
  const approximate = Object.values(KEYWORDS).filter((k) => k.support === "partial").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-semibold tracking-tight text-space-50">Keywords the engine knows</h1>
        <Link href="/arena/rules" className="ml-auto text-xs text-space-300 hover:text-ki-300">
          ← The rules of your cards
        </Link>
      </div>
      <p className="text-sm text-space-300">
        All {total} keyword skills the arena&rsquo;s parser reads, with what the Rule Manual says and what this engine actually does with it. The second line is the one
        worth reading: {approximate} of them are played to an approximation, and each says where it differs. Section numbers are{" "}
        <span className="font-mono text-[11px]">docs/rules/rulemanual.txt</span>.
      </p>

      <nav className="flex flex-wrap gap-1.5 text-[11px]">
        {groups.map((g) => (
          <a key={g.group} href={`#${g.group}`} className="tap rounded-md bg-space-900 px-2.5 py-1.5 text-space-300 hover:text-ki-300">
            {g.label} ({g.entries.length})
          </a>
        ))}
        <a href="#modifiers" className="tap rounded-md bg-space-900 px-2.5 py-1.5 text-space-300 hover:text-ki-300">
          Not skills ({MODIFIERS.length})
        </a>
        <a href="#types" className="tap rounded-md bg-space-900 px-2.5 py-1.5 text-space-300 hover:text-ki-300">
          Skill types
        </a>
        <a href="#reading" className="tap rounded-md bg-space-900 px-2.5 py-1.5 text-space-300 hover:text-ki-300">
          How a line is read
        </a>
      </nav>

      {groups.map((g) => (
        <section key={g.group} id={g.group} className="scroll-mt-4 space-y-2">
          <h2 className="text-xs uppercase tracking-widest text-space-400">{g.label}</h2>
          <ul className="space-y-2">
            {g.entries.map((k) => (
              <li key={k.name} className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-mono text-sm font-medium text-space-100">{k.tag}</span>
                  {k.also?.map((a) => (
                    <span key={a} className="font-mono text-[11px] text-space-400">
                      {a}
                    </span>
                  ))}
                  <span className="font-mono text-[10px] text-space-500">{k.type}</span>
                  <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] ${SUPPORT_CLASS[k.support]}`}>{SUPPORT_LABEL[k.support]}</span>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-space-200">{k.meaning}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-space-400">
                  <span className="text-space-500">the engine: </span>
                  {k.engine}
                </p>
                <p className="mt-1 font-mono text-[10px] text-space-600">Rule Manual {k.section}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section id="modifiers" className="scroll-mt-4 space-y-2">
        <h2 className="text-xs uppercase tracking-widest text-space-400">Bracketed words that are not skills</h2>
        <p className="text-[13px] text-space-300">
          22-1-2: these limit or price the skill they are printed on without being skills themselves, so the line keeps its own [Auto] or [Activate] type.
        </p>
        <ul className="space-y-2">
          {MODIFIERS.map((m) => (
            <li key={m.tag} className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-sm font-medium text-space-100">{m.tag}</span>
                <span className="ml-auto font-mono text-[10px] text-space-600">{m.section}</span>
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-space-200">{m.meaning}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-space-400">
                <span className="text-space-500">the engine: </span>
                {m.engine}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section id="types" className="scroll-mt-4 space-y-2">
        <h2 className="text-xs uppercase tracking-widest text-space-400">Skill types</h2>
        <p className="text-[13px] text-space-300">
          The tag a skill line opens with decides when it happens. A line with no type tag at all is read as [Permanent], which is why a mis-set tag is one of the
          easier mistakes to make when you set a card&rsquo;s rule by hand.
        </p>
        <ul className="space-y-2">
          {Object.entries(SKILL_TYPES).map(([kind, t]) => (
            <li key={kind} className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-sm font-medium text-space-100">{t.tag}</span>
                <span className="ml-auto font-mono text-[10px] text-space-600">{t.section}</span>
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-space-200">{t.meaning}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-space-400">
                <span className="text-space-500">the engine: </span>
                {t.engine}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section id="reading" className="scroll-mt-4 space-y-2">
        <h2 className="text-xs uppercase tracking-widest text-space-400">How the compiler reads a line</h2>
        <ol className="space-y-2">
          {READING_RULES.map((r, i) => (
            <li key={r.title} className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
              <p className="text-[13px] font-medium text-space-100">
                <span className="mr-1.5 font-mono text-[11px] text-space-500">{i + 1}.</span>
                {r.title}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-space-300">{r.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <p className="text-[11px] text-space-500">
        Which of your own cards the engine reads, and where to set one yourself, is on{" "}
        <Link href="/arena/rules" className="text-ki-300 hover:underline">
          the rules of your cards
        </Link>
        ; the wordings it cannot read at all are on{" "}
        <Link href="/arena/backlog" className="text-ki-300 hover:underline">
          the backlog
        </Link>
        .
      </p>
    </div>
  );
}
