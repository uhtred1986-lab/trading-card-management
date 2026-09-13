import Link from "next/link";
import { languageReference, type RefCond, type RefOp } from "@/lib/arena/lang/reference";

export const metadata = { title: "The rules language" };

const CLASS_CLASS = "rounded px-1.5 py-0.5 text-[10px] bg-space-800 text-space-300";

/** The fields table shared by an op and a condition row. */
function FieldsTable({ fields }: { fields: { name: string; type: string; required: boolean; nullable: boolean; enumValues?: string[]; listOf?: "string" | "enum"; defaultText?: string }[] }) {
  if (!fields.length) return <p className="text-[11px] text-space-500">no fields</p>;
  return (
    <table className="w-full text-left text-[11px]">
      <thead>
        <tr className="text-space-500">
          <th className="pr-3 font-normal">field</th>
          <th className="pr-3 font-normal">type</th>
          <th className="pr-3 font-normal">required</th>
          <th className="font-normal">values</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((f) => (
          <tr key={f.name} className="border-t border-space-800/70 align-top">
            <td className="py-1 pr-3 font-mono text-space-100">{f.name}</td>
            <td className="py-1 pr-3 font-mono text-space-400">
              {f.type}
              {f.listOf ? `[${f.listOf}]` : ""}
            </td>
            <td className="py-1 pr-3 text-space-400">{f.required ? "yes" : f.nullable ? "optional, or null" : "optional"}</td>
            <td className="py-1 font-mono text-space-400">{f.enumValues ? f.enumValues.map((v) => `"${v}"`).join(" | ") : f.defaultText ? <span className="text-space-500">default {f.defaultText}</span> : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OpCard({ op }: { op: RefOp }) {
  return (
    <li id={`op-${op.name}`} className="scroll-mt-4 rounded-xl border border-space-700/70 bg-space-900/50 p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-sm font-medium text-space-100">{op.name}</span>
        <span className={`ml-auto shrink-0 ${CLASS_CLASS}`}>{op.class}</span>
      </div>
      {op.doc && <p className="mt-1.5 text-[12px] leading-relaxed text-space-300">{op.doc}</p>}
      <p className="mt-1.5 break-all font-mono text-[11px] text-space-500">{op.signature}</p>
      <div className="mt-2">
        <FieldsTable fields={op.fields} />
      </div>
      {op.sentence && (
        <p className="mt-2 text-[12px] leading-relaxed text-space-200">
          <span className="text-space-500">reads: </span>
          {op.sentence}
        </p>
      )}
    </li>
  );
}

function CondCard({ cond }: { cond: RefCond }) {
  return (
    <li id={`cond-${cond.kind}`} className="scroll-mt-4 rounded-xl border border-space-700/70 bg-space-900/50 p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-sm font-medium text-space-100">{cond.kind}</span>
        <span className={`ml-auto shrink-0 ${CLASS_CLASS}`}>{cond.class}</span>
      </div>
      {cond.doc && <p className="mt-1.5 text-[12px] leading-relaxed text-space-300">{cond.doc}</p>}
      <p className="mt-1.5 break-all font-mono text-[11px] text-space-500">{cond.signature}</p>
      <div className="mt-2">
        <FieldsTable fields={cond.fields} />
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-space-200">
        <span className="text-space-500">reads: </span>
        {cond.sentence}
      </p>
    </li>
  );
}

/**
 * Every op and condition the rules language can write, generated at render
 * from `OP_SCHEMA`, `COND_SCHEMA` and the other tables `lang/reference.ts`
 * reads — never a hand-kept list. This is the page `docs/arena-rules-
 * language.md` §3 points to instead of listing statements itself: "what can I
 * write after THEN" answered by the same rows the compiler, the printer and
 * the parser already read.
 */
export default function LanguageReferencePage() {
  const ref = languageReference();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-semibold tracking-tight text-space-50">The rules language</h1>
        <Link href="/arena/rules" className="ml-auto text-xs text-space-300 hover:text-ki-300">
          ← The rules of your cards
        </Link>
      </div>
      <p className="text-sm text-space-300">
        Every statement and condition the text view accepts after <span className="font-mono text-[11px]">THEN</span> and{" "}
        <span className="font-mono text-[11px]">IF</span>, with its fields, and the selectors, filters, expressions, price items, triggers and literals the rest of a rule is built from. Generated from
        the same tables the compiler, the printer and the parser read — <span className="font-mono text-[11px]">docs/arena-rules-language.md</span> explains the grammar these fill in.
      </p>

      <nav className="flex flex-wrap gap-1.5 text-[11px]">
        <a href="#ops" className="tap rounded-md bg-space-900 px-2.5 py-1.5 text-space-300 hover:text-ki-300">
          Statements ({ref.ops.length})
        </a>
        <a href="#conds" className="tap rounded-md bg-space-900 px-2.5 py-1.5 text-space-300 hover:text-ki-300">
          Conditions ({ref.conds.length})
        </a>
        <a href="#selector" className="tap rounded-md bg-space-900 px-2.5 py-1.5 text-space-300 hover:text-ki-300">
          Selectors
        </a>
        <a href="#filter" className="tap rounded-md bg-space-900 px-2.5 py-1.5 text-space-300 hover:text-ki-300">
          Filters
        </a>
        <a href="#expr" className="tap rounded-md bg-space-900 px-2.5 py-1.5 text-space-300 hover:text-ki-300">
          Expressions
        </a>
        <a href="#cost" className="tap rounded-md bg-space-900 px-2.5 py-1.5 text-space-300 hover:text-ki-300">
          COST items
        </a>
        <a href="#trigger" className="tap rounded-md bg-space-900 px-2.5 py-1.5 text-space-300 hover:text-ki-300">
          WHEN moments
        </a>
        <a href="#literals" className="tap rounded-md bg-space-900 px-2.5 py-1.5 text-space-300 hover:text-ki-300">
          Literals
        </a>
      </nav>

      <section id="ops" className="scroll-mt-4 space-y-2">
        <h2 className="text-xs uppercase tracking-widest text-space-400">Statements — what THEN and DO accept</h2>
        <ul className="space-y-2">
          {ref.ops.map((op) => (
            <OpCard key={op.name} op={op} />
          ))}
        </ul>
      </section>

      <section id="conds" className="scroll-mt-4 space-y-2">
        <h2 className="text-xs uppercase tracking-widest text-space-400">Conditions — what IF accepts</h2>
        <ul className="space-y-2">
          {ref.conds.map((cond) => (
            <CondCard key={cond.kind} cond={cond} />
          ))}
        </ul>
      </section>

      <section id="selector" className="scroll-mt-4 space-y-2">
        <h2 className="text-xs uppercase tracking-widest text-space-400">The selector — SEL&rsquo;s parts and flags</h2>
        <p className="text-[13px] text-space-300">
          A selector is printed positionally — <span className="font-mono text-[11px]">1 blue card IN opponent.battle rest</span> — in this order; the parser takes the parts in any order.
        </p>
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="text-space-500">
              <th className="pr-3 font-normal">field</th>
              <th className="font-normal">part</th>
            </tr>
          </thead>
          <tbody>
            {ref.selectorFields.map((f) => (
              <tr key={f.field} className="border-t border-space-800/70">
                <td className="py-1 pr-3 font-mono text-space-100">{f.field}</td>
                <td className="py-1 font-mono text-space-400">{f.part}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[13px] text-space-300">The literal flag words a selector may end with:</p>
        <ul className="space-y-1.5">
          {ref.selectorFlags.map((f) => (
            <li key={f.word} className="rounded-lg border border-space-700/70 bg-space-900/50 px-3 py-1.5 text-[12px]">
              <span className="font-mono text-space-100">{f.word}</span> <span className="text-space-400">— {f.doc}</span>
            </li>
          ))}
        </ul>
      </section>

      <section id="filter" className="scroll-mt-4 space-y-2">
        <h2 className="text-xs uppercase tracking-widest text-space-400">The card filter — printed-form words</h2>
        <p className="text-[13px] text-space-300">
          A filter is printed in its own words when the parser reads them back exactly; otherwise as field predicates. Each row is the words a filter carrying only that field contributes.
        </p>
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="text-space-500">
              <th className="pr-3 font-normal">field</th>
              <th className="pr-3 font-normal">type</th>
              <th className="font-normal">printed as</th>
            </tr>
          </thead>
          <tbody>
            {ref.filterFields.map((f) => (
              <tr key={f.field} className="border-t border-space-800/70">
                <td className="py-1 pr-3 font-mono text-space-100">{f.field}</td>
                <td className="py-1 pr-3 font-mono text-space-500">{f.type}</td>
                <td className="py-1 text-space-300">{f.printed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section id="expr" className="scroll-mt-4 space-y-2">
        <h2 className="text-xs uppercase tracking-widest text-space-400">Expressions — what an AMOUNT may be</h2>
        <ul className="space-y-1.5">
          {ref.expressions.map((e) => (
            <li key={e.key} className="rounded-lg border border-space-700/70 bg-space-900/50 px-3 py-1.5 text-[12px]">
              <span className="font-mono text-space-100">{e.example}</span>
              {e.maxExample && e.maxExample !== e.example && <span className="ml-2 font-mono text-space-500">{e.maxExample}</span>}
            </li>
          ))}
          {ref.exprLiterals.map((l) => (
            <li key={l.key} className="rounded-lg border border-space-700/70 bg-space-900/50 px-3 py-1.5 text-[12px]">
              <span className="font-mono text-space-100">{l.syntax}</span> <span className="text-space-500">— literal, no call name</span>
            </li>
          ))}
        </ul>
        <p className="text-[12px] text-space-400">
          The measures <span className="font-mono text-[11px]">attr</span> and <span className="font-mono text-[11px]">sumOf</span> may read: {ref.exprAttrs.join(", ")}.
        </p>
      </section>

      <section id="cost" className="scroll-mt-4 space-y-2">
        <h2 className="text-xs uppercase tracking-widest text-space-400">COST — the price grammar</h2>
        <ul className="space-y-1.5">
          {ref.costItems.map((c) => (
            <li key={c.syntax} className="rounded-lg border border-space-700/70 bg-space-900/50 px-3 py-1.5 text-[12px]">
              <span className="font-mono text-space-100">{c.syntax}</span> <span className="text-space-400">— {c.doc}</span>
            </li>
          ))}
        </ul>
      </section>

      <section id="trigger" className="scroll-mt-4 space-y-2">
        <h2 className="text-xs uppercase tracking-widest text-space-400">WHEN — the moments an [Auto] or [Counter] may answer to</h2>
        <p className="text-[13px] text-space-300">
          The same list <span className="font-mono text-[11px]">validateRule</span> checks a rule&rsquo;s WHEN against — a moment not here is refused rather than stored as a skill that silently
          never happens.
        </p>
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {ref.triggers.map((t) => (
            <li key={t.name} className="rounded-lg border border-space-700/70 bg-space-900/50 px-3 py-1.5 text-[12px]">
              <span className="font-mono text-space-100">{t.name}</span>
              <span className="block text-space-400">{t.words}</span>
            </li>
          ))}
        </ul>
      </section>

      <section id="literals" className="scroll-mt-4 space-y-2">
        <h2 className="text-xs uppercase tracking-widest text-space-400">Literals</h2>
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="text-space-500">
              <th className="w-2/3 pr-3 font-normal">written</th>
              <th className="font-normal">is</th>
            </tr>
          </thead>
          <tbody>
            {ref.literals.map((l) => (
              <tr key={l.is} className="border-t border-space-800/70 align-top">
                <td className="py-1.5 pr-3 font-mono text-space-100">{l.written}</td>
                <td className="py-1.5 text-space-300">{l.is}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="text-[11px] text-space-500">
        The keywords themselves — what each means and what the engine does with it — are on{" "}
        <Link href="/arena/rules/keywords" className="text-ki-300 hover:underline">
          the keywords page
        </Link>
        ; a card&rsquo;s own record is edited on{" "}
        <Link href="/arena/rules" className="text-ki-300 hover:underline">
          the rules of your cards
        </Link>
        .
      </p>
    </div>
  );
}
