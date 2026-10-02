"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { EXPR_ATTRS, FILTER_FIELDS, type Rule } from "@/lib/arena/lang";
import type { FilterFieldType } from "@/lib/arena/lang/ast";
import {
  AMOUNT_SHAPES,
  CLAUSE_WORDS,
  COST_ITEM_SPECS,
  SELECTOR_FLAG_WORDS,
  SELECTOR_SPECIALS,
  addCostItem,
  allBound,
  amountShape,
  blankAmount,
  blankCond,
  blankFilterValue,
  blankOp,
  boundBefore,
  choicesFor,
  condReading,
  costItemReading,
  costItems,
  editCostItem,
  exprFields,
  exprSpec,
  fieldWords,
  filterFieldsSet,
  filterOptions,
  filterReading,
  flagOn,
  howMany,
  insertAt,
  moveAt,
  opReading,
  optionsOf,
  problemsUnder,
  removeAt,
  searchChoices,
  selectValue,
  selectWrite,
  selectorReading,
  sentenceParts,
  setAt,
  setFilterField,
  setFlag,
  setHowMany,
  shownFields,
  templateFields,
  triggerReading,
  controlFor,
  type Choice,
  type CostItem,
  type CostSyntax,
  type HowMany,
  type Part,
  type Problem,
} from "@/lib/arena/lang/blocks";
import { childPath, resolvePath, type RuleClause, type RulePath } from "@/lib/arena/lang/path";
import { COND_SCHEMA, OP_SCHEMA, type Cond, type Op, type OpField, type Selector } from "@/lib/arena/vm/script";
import type { CardFilter } from "@/lib/arena/text/filters";

/**
 * The block editor (#469): a rule as WHEN · COST · IF · THEN, each clause a
 * list of blocks, each block a sentence whose blanks are its row's fields.
 *
 * One component for the workbench record and the phone builder. Every control
 * is picked by a blank's field type (`controlFor`), every list of what may be
 * added comes off the schema (`choicesFor`), so an op, a condition or a field
 * type the language gains is editable here with no change to this file. The
 * logic lives in `lib/arena/lang/blocks.ts`, which `scripts/verify/blocks.ts`
 * proves without a browser; this is its rendering.
 *
 * Every edit goes through a `RulePath` into the one `Rule` — the blocks never
 * hold a second copy of it, so blocks and the text view cannot disagree.
 */

type Loose = Record<string, unknown>;

interface Ctx {
  rule: Rule;
  edit: (fn: (r: Rule) => Rule) => void;
  problems: readonly Problem[];
  focus: RulePath | null;
  permanent: boolean;
}
const BlocksCtx = createContext<Ctx | null>(null);
const useBlocks = (): Ctx => {
  const c = useContext(BlocksCtx);
  if (!c) throw new Error("a block outside RuleBlocks");
  return c;
};

const TONE: Record<RuleClause, { word: string; ring: string }> = {
  trigger: { word: "text-ki-300", ring: "border-ki-500/50" },
  cost: { word: "text-space-300", ring: "border-space-500" },
  cond: { word: "text-dbs-blue", ring: "border-dbs-blue/60" },
  ops: { word: "text-ki-300", ring: "border-ki-500/50" },
};

const chip = "tap rounded-lg border border-dbs-blue/50 bg-dbs-blue/10 px-2 py-1 text-[13px] font-semibold text-space-50";
const blankCls = "border-dashed border-loss bg-loss/10 text-loss";
const small = "tap rounded-lg border border-space-600 px-2 py-1 text-[12px] text-space-300 hover:border-space-300 disabled:opacity-30";
const addCls = "tap rounded-lg border border-dashed border-space-600 px-3 py-1.5 text-[12px] font-semibold text-space-300 hover:border-ki-500 hover:text-ki-300";

/** The problems at exactly this path — the blank's own, not the ones inside a nested block. */
const own = (problems: readonly Problem[], path: RulePath) => problems.filter((p) => p.path === path);

export interface RuleBlocksProps {
  rule: Rule;
  onChange: (rule: Rule) => void;
  problems: readonly Problem[];
  /** The block to open on and ring: `ops[1]`, `cond`, `cost.condition`. */
  focusPath?: RulePath | null;
  permanent?: boolean;
  /** Only these clauses (the workbench record shows all four; a teach panel may want one). */
  clauses?: readonly RuleClause[];
}

export function RuleBlocks({ rule, onChange, problems, focusPath = null, permanent = false, clauses = ["trigger", "cost", "cond", "ops"] }: RuleBlocksProps) {
  // `edit` reads the newest rule through a ref so two quick edits never start from the same stale one.
  const latest = useRef(rule);
  useEffect(() => {
    latest.current = rule;
  }, [rule]);
  const edit = (fn: (r: Rule) => Rule) => {
    const next = fn(latest.current);
    latest.current = next;
    onChange(next);
  };
  return (
    <BlocksCtx.Provider value={{ rule, edit, problems, focus: focusPath, permanent }}>
      <div className="space-y-3">
        {clauses.map((c) => (
          <Clause key={c} clause={c} />
        ))}
      </div>
    </BlocksCtx.Provider>
  );
}

// ── a clause ────────────────────────────────────────────────────────────────

function Clause({ clause }: { clause: RuleClause }) {
  const { rule, edit, problems, focus } = useBlocks();
  const ref = useRef<HTMLElement>(null);
  const focused = focus === clause;
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focused]);
  const clauseProblems = own(problems, clause);
  const empty = clause === "trigger" ? !rule.trigger.length : clause === "cost" ? !rule.cost : clause === "cond" ? !rule.cond : !rule.ops.length;

  return (
    <section ref={ref} data-path={clause} aria-label={CLAUSE_WORDS[clause]} className={`rounded-2xl border bg-space-900/60 p-3 ${focused ? "border-ki-500 ring-2 ring-ki-500/40" : "border-space-700"}`}>
      <header className="mb-2 flex items-baseline gap-2">
        <h3 className={`text-[12px] font-bold tracking-[0.14em] ${TONE[clause].word}`}>{CLAUSE_WORDS[clause]}</h3>
        {clause === "trigger" && <span className="rounded bg-space-800 px-1.5 py-0.5 font-mono text-[11px] text-space-300" title="the printed skill tag comes off the card and cannot be edited">[{rule.kind}]</span>}
        {empty && <span className="text-[11px] text-space-500">{clause === "cond" ? "always — no condition" : clause === "cost" ? "no price" : clause === "trigger" ? "no moment named" : "does nothing yet"}</span>}
      </header>
      {clauseProblems.map((p) => (
        <p key={p.message} className="mb-2 rounded-lg bg-loss/10 px-2 py-1 text-[12px] text-loss">
          {p.message}
        </p>
      ))}
      <div className="space-y-2">
        {clause === "trigger" &&
          rule.trigger.map((t, i) => (
            <BlockFrame key={`${t}-${i}`} path={`trigger[${i}]`} title={t} reading={triggerReading(t)} onRemove={() => edit((r) => removeAt(r, `trigger[${i}]`))} />
          ))}
        {clause === "cost" && <CostClause />}
        {clause === "cond" && rule.cond && <CondBlock path="cond" onRemove={() => edit((r) => ({ ...r, cond: null }))} />}
        {clause === "ops" && <OpList path="ops" />}
      </div>
      {clause === "trigger" && <Picker clause="trigger" label="+ add a moment" onPick={(c) => edit((r) => (r.trigger.includes(c.key as Rule["trigger"][number]) ? r : { ...r, trigger: [...r.trigger, c.key as Rule["trigger"][number]] }))} />}
      {clause === "cond" && !rule.cond && <Picker clause="cond" label="+ add a condition" onPick={(c) => edit((r) => ({ ...r, cond: blankCond(c.key as Cond["kind"]) }))} />}
      {clause === "cost" && <CostPicker />}
    </section>
  );
}

/** The frame every block shares: its key, its sentence, its reading underneath, and its problems. */
function BlockFrame({ path, title, reading, children, onRemove, onMove, nested }: { path: RulePath; title: string; reading: string; children?: ReactNode; onRemove?: () => void; onMove?: (by: number) => void; nested?: boolean }) {
  const { problems, focus } = useBlocks();
  const ref = useRef<HTMLDivElement>(null);
  const focused = focus === path;
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focused]);
  const mine = own(problems, path);
  const inside = problemsUnder(problems, path).length > 0;
  return (
    <div
      ref={ref}
      data-path={path}
      className={`rounded-xl border p-2 ${nested ? "bg-space-950/50" : "bg-space-800/70"} ${focused ? "border-ki-500 ring-2 ring-ki-500/40" : inside ? "border-loss/60" : "border-space-600"}`}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded bg-space-950 px-1.5 py-0.5 font-mono text-[10px] text-space-400">{title}</span>
        {(onMove || onRemove) && (
          <div className="ml-auto flex shrink-0 gap-1">
            {onMove && (
              <>
                <button type="button" className={small} onClick={() => onMove(-1)} aria-label="one step earlier">
                  ↑
                </button>
                <button type="button" className={small} onClick={() => onMove(1)} aria-label="one step later">
                  ↓
                </button>
              </>
            )}
            {onRemove && (
              <button type="button" className={`${small} hover:text-loss`} onClick={onRemove} aria-label="remove this block">
                ×
              </button>
            )}
          </div>
        )}
      </div>
      {children && <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1.5 text-[14px] text-space-100">{children}</div>}
      <p className="mt-1.5 text-[12px] leading-snug text-space-400">
        <span className="text-space-500">reads: </span>
        <span className="text-space-200">{reading}</span>
      </p>
      {mine.map((p) => (
        <p key={p.message} className="mt-1 text-[12px] text-loss">
          {p.message}
        </p>
      ))}
    </div>
  );
}

// ── the add list ────────────────────────────────────────────────────────────

/** "+ add": a searchable list, in plain words, of what the schema lets stand in this clause. */
function Picker({ clause, label, onPick }: { clause: RuleClause; label: string; onPick: (c: Choice) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const all = choicesFor(clause);
  const found = searchChoices(all, q);
  const groups = [...new Set(found.map((c) => c.group))];
  if (!open)
    return (
      <button type="button" className={`${addCls} mt-2`} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  return (
    <div className="mt-2 rounded-xl border border-space-600 bg-space-950 p-2">
      <div className="flex gap-2">
        <input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`search ${all.length} ${clause === "ops" ? "steps" : clause === "cond" ? "conditions" : clause === "cost" ? "price items" : "moments"}`} className="tap min-w-0 flex-1 rounded-lg border border-space-600 bg-space-900 px-2 text-[14px] text-space-100" />
        <button type="button" className={small} onClick={() => setOpen(false)}>
          close
        </button>
      </div>
      <div className="mt-2 max-h-80 space-y-2 overflow-y-auto">
        {groups.map((g) => (
          <div key={g}>
            <div className="px-1 text-[10px] font-bold uppercase tracking-[0.12em] text-space-500">{g}</div>
            <div className="mt-1 flex flex-col gap-1">
              {found
                .filter((c) => c.group === g)
                .map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className="tap flex flex-col items-start rounded-lg border border-space-700 bg-space-900 px-2.5 py-1.5 text-left hover:border-ki-500"
                    onClick={() => {
                      onPick(c);
                      setOpen(false);
                      setQ("");
                    }}
                  >
                    <span className="text-[14px] text-space-100">{c.label}</span>
                    <span className="font-mono text-[10px] text-space-500">{c.key}</span>
                  </button>
                ))}
            </div>
          </div>
        ))}
        {!found.length && <p className="px-1 text-[12px] text-space-500">nothing matches</p>}
      </div>
    </div>
  );
}

// ── the price ───────────────────────────────────────────────────────────────

function CostClause() {
  const { rule, edit } = useBlocks();
  const items = costItems(rule.cost);
  return (
    <>
      {items.map((item, i) => (
        <CostItemBlock key={`${item.path}-${i}`} item={item} index={i} />
      ))}
      {rule.cost && !items.length && (
        <button type="button" className={small} onClick={() => edit((r) => ({ ...r, cost: null }))}>
          drop the empty price
        </button>
      )}
    </>
  );
}

function CostPicker() {
  const { edit } = useBlocks();
  const [askIf, setAskIf] = useState(false);
  if (askIf) return <Picker clause="cond" label="+ the price's condition" onPick={(c) => (edit((r) => ({ ...r, cost: addCostItem(r.cost, "IF", { condition: blankCond(c.key as Cond["kind"]) }) })), setAskIf(false))} />;
  return (
    <Picker
      clause="cost"
      label="+ add to the price"
      onPick={(c) => {
        // The price's IF holds a condition, and an empty one is not a price: ask which, at once.
        if (c.key === "IF") setAskIf(true);
        else edit((r) => ({ ...r, cost: addCostItem(r.cost, c.key as CostSyntax) }));
      }}
    />
  );
}

function CostItemBlock({ item, index }: { item: CostItem; index: number }) {
  const { rule, edit } = useBlocks();
  const spec = COST_ITEM_SPECS[item.key];
  const write = (values: Loose | null) => edit((r) => {
    const cost = editCostItem(r.cost, index, values);
    return { ...r, cost: costItems(cost).length || values !== null ? cost : null };
  });
  return (
    <BlockFrame path={item.path} title={item.key} reading={costItemReading(item)} onRemove={() => write(null)}>
      {spec.fields.map((f) =>
        f.type === "cond" ? (
          <div key={f.name} className="w-full">
            <CondBlock path={item.path} nested onRemove={() => write(null)} />
          </div>
        ) : f.type === "ops" ? (
          <div key={f.name} className="w-full">
            <OpList path={item.path} nested />
          </div>
        ) : (
          <Labeled key={f.name} name={f.name}>
            <FieldControl field={f} path={item.path} value={item.values[f.name]} onChange={(v) => write({ ...item.values, [f.name]: v })} rule={rule} />
          </Labeled>
        ),
      )}
    </BlockFrame>
  );
}

// ── steps and conditions ────────────────────────────────────────────────────

/** A list of steps — THEN, or a step's nested program — with its own "+ add". */
function OpList({ path, nested }: { path: RulePath; nested?: boolean }) {
  const { rule, edit } = useBlocks();
  const ops = (resolvePath(rule, path) as Op[] | undefined) ?? [];
  return (
    <div className={`flex w-full flex-col gap-2 ${nested ? "border-l-2 border-space-700 pl-2" : ""}`}>
      {ops.map((_, i) => (
        <OpBlock key={i} path={childPath(path, i)} nested={nested} />
      ))}
      <Picker clause="ops" label={nested ? "+ step" : "+ add a step"} onPick={(c) => edit((r) => insertAt(r, path, ops.length, blankOp(c.key as Op["op"], allBound(r))))} />
    </div>
  );
}

function OpBlock({ path, nested }: { path: RulePath; nested?: boolean }) {
  const { rule, edit, permanent } = useBlocks();
  const op = resolvePath(rule, path) as Op;
  const spec = OP_SCHEMA[op.op];
  return (
    <BlockFrame path={path} title={op.op} reading={opReading(op, permanent)} nested={nested} onRemove={() => edit((r) => removeAt(r, path))} onMove={(by) => edit((r) => moveAt(r, path, by))}>
      <Sentence node={op as unknown as Loose} path={path} fields={spec.fields} parts={sentenceParts(spec.sentence)} />
    </BlockFrame>
  );
}

function CondBlock({ path, nested, onRemove }: { path: RulePath; nested?: boolean; onRemove?: () => void }) {
  const { rule, edit } = useBlocks();
  const cond = resolvePath(rule, path) as Cond | undefined;
  if (!cond) return <Picker clause="cond" label="+ condition" onPick={(c) => edit((r) => setAt(r, path, blankCond(c.key as Cond["kind"])))} />;
  const spec = COND_SCHEMA[cond.kind];
  return (
    <BlockFrame path={path} title={cond.kind} reading={condReading(cond)} nested={nested} onRemove={onRemove ?? (() => edit((r) => removeAt(r, path)))}>
      <Sentence node={cond as unknown as Loose} path={path} fields={spec.fields} parts={null} />
    </BlockFrame>
  );
}

/**
 * The sentence with blanks. With a template, the words and blanks are the
 * template's; any field it does not name follows, labelled. An optional field
 * left unset waits behind "+ more" so a block on a phone stays one sentence.
 */
function Sentence({ node, path, fields, parts }: { node: Loose; path: RulePath; fields: readonly OpField[]; parts: Part[] | null }) {
  const { rule, edit } = useBlocks();
  const [more, setMore] = useState(false);
  const shown = shownFields(fields, node);
  const byName = new Map(shown.map((f) => [f.name, f]));
  const inTemplate = new Set(templateFields(parts));
  const set = (name: string, v: unknown) => edit((r) => setAt(r, childPath(path, name), v));
  const control = (f: OpField) => <FieldControl key={f.name} field={f} path={childPath(path, f.name)} value={node[f.name]} onChange={(v) => set(f.name, v)} rule={rule} />;

  const render = (ps: Part[]): ReactElement[] =>
    ps.flatMap((p, i) => {
      if ("text" in p) return p.text.trim() ? [<span key={`t${i}`} className="text-space-300">{p.text.trim()}</span>] : [];
      if ("field" in p) {
        const f = byName.get(p.field);
        return f ? [control(f)] : [];
      }
      return node[p.when] !== undefined ? render(p.parts) : [];
    });

  // Without a template, every blank is listed; with one, the ones it leaves out.
  const rest = shown.filter((f) => !parts || !inTemplate.has(f.name));
  const inline = rest.filter((f) => !parts || f.required || node[f.name] !== undefined);
  const later = rest.filter((f) => !inline.includes(f));
  return (
    <>
      {parts && render(parts)}
      {inline.map((f) =>
        isNestedField(f) ? (
          <div key={f.name} className="w-full">
            <span className="text-[11px] text-space-500">{fieldWords(f.name)}</span>
            {control(f)}
          </div>
        ) : (
          <Labeled key={f.name} name={f.name}>
            {control(f)}
          </Labeled>
        ),
      )}
      {later.length > 0 &&
        (more ? (
          later.map((f) => (
            <Labeled key={f.name} name={f.name}>
              {control(f)}
            </Labeled>
          ))
        ) : (
          <button type="button" className={small} onClick={() => setMore(true)}>
            + more ({later.map((f) => fieldWords(f.name)).join(", ")})
          </button>
        ))}
    </>
  );
}

const isNestedField = (f: OpField) => ["cond", "conds", "ops", "modes", "selector", "filter"].includes(controlFor(f.type));

function Labeled({ name, children }: { name: string; children: ReactNode }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="text-[11px] text-space-500">{fieldWords(name)}</span>
      {children}
    </span>
  );
}

// ── one blank, by its field type ────────────────────────────────────────────

function FieldControl({ field, path, value, onChange, rule }: { field: OpField; path: RulePath; value: unknown; onChange: (v: unknown) => void; rule: Rule }) {
  const { problems } = useBlocks();
  const bad = own(problems, path).length > 0;
  const t = field.type;
  const optional = !field.required;
  switch (controlFor(t)) {
    case "select":
      return <Select value={selectValue(t, value)} options={optionsOf(t)} optional={optional} bad={bad || (value === undefined && !optional)} label={field.name} onChange={(w) => onChange(selectWrite(t, w))} />;
    case "multi":
      return <Multi value={(value as string[]) ?? []} options={optionsOf(t)} bad={bad} onChange={(v) => onChange(v.length || !optional ? v : undefined)} />;
    case "strings":
      return <Strings value={(value as string[]) ?? []} bad={bad} onChange={(v) => onChange(v.length || !optional ? v : undefined)} />;
    case "number":
      return <Stepper value={value as number | null | undefined} bad={bad || (value === undefined && !optional)} label={field.name} onChange={(n) => onChange(n === undefined ? (field.nullable ? null : undefined) : n)} />;
    case "toggle":
      return <Toggle value={value as boolean | undefined} optional={optional} bad={bad || (value === undefined && !optional)} onChange={onChange} />;
    case "text":
      return <input aria-label={field.name} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || (optional ? undefined : ""))} className={`${chip} w-32 ${bad || (value === undefined && !optional) ? blankCls : ""}`} placeholder="fill this" />;
    case "amount":
      return <AmountControl value={value} path={path} bad={bad || (value === undefined && !optional)} onChange={onChange} rule={rule} />;
    case "filter":
      return <FilterBuilder value={value as CardFilter | undefined} onChange={onChange} />;
    case "selector":
      return <SelectorBuilder value={value as Selector | undefined} path={path} bad={bad} onChange={onChange} rule={rule} />;
    case "ref":
      return <RefControl value={value as Loose | undefined} path={path} optional={optional} bad={bad || (value === undefined && !optional)} onChange={onChange} rule={rule} />;
    case "cond":
      return <CondBlock path={path} nested onRemove={optional ? () => onChange(undefined) : undefined} />;
    case "conds":
      return <CondList path={path} />;
    case "ops":
      return <OpList path={path} nested />;
    case "modes":
      return <ModesControl path={path} />;
  }
}

function Select({ value, options, optional, bad, label, onChange }: { value: string; options: readonly string[]; optional: boolean; bad: boolean; label: string; onChange: (w: string) => void }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={`${chip} ${bad ? blankCls : ""}`}>
      {(optional || value === "") && <option value="">{optional ? "—" : "fill this"}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Multi({ value, options, bad, onChange }: { value: string[]; options: readonly string[]; bad: boolean; onChange: (v: string[]) => void }) {
  return (
    <span className={`inline-flex flex-wrap gap-1 rounded-lg ${bad ? "outline outline-1 outline-dashed outline-loss" : ""}`}>
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button key={o} type="button" aria-pressed={on} className={`tap rounded-lg border px-2 py-1 text-[12px] ${on ? "border-dbs-blue bg-dbs-blue/25 text-space-50" : "border-space-600 text-space-400"}`} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}>
            {o}
          </button>
        );
      })}
    </span>
  );
}

function Strings({ value, bad, onChange }: { value: string[]; bad: boolean; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(", "));
  return <input value={text} placeholder="a, b" onChange={(e) => setText(e.target.value)} onBlur={() => onChange(text.split(",").map((s) => s.trim()).filter(Boolean))} className={`${chip} w-36 ${bad ? blankCls : ""}`} />;
}

function Stepper({ value, bad, label, onChange }: { value: number | null | undefined; bad: boolean; label: string; onChange: (n: number | undefined) => void }) {
  const n = typeof value === "number" ? value : null;
  return (
    <span className={`inline-flex items-center rounded-lg border ${bad ? "border-dashed border-loss" : "border-dbs-blue/50"}`}>
      <button type="button" className="tap px-2 text-space-300" aria-label={`${label} one less`} onClick={() => onChange((n ?? 1) - 1)}>
        −
      </button>
      <input aria-label={label} inputMode="numeric" value={n ?? ""} placeholder="?" onChange={(e) => onChange(e.target.value.trim() === "" || Number.isNaN(Number(e.target.value)) ? undefined : Number(e.target.value))} className="w-12 bg-transparent text-center text-[14px] font-semibold text-space-50 outline-none" />
      <button type="button" className="tap px-2 text-space-300" aria-label={`${label} one more`} onClick={() => onChange((n ?? 0) + 1)}>
        +
      </button>
    </span>
  );
}

function Toggle({ value, optional, bad, onChange }: { value: boolean | undefined; optional: boolean; bad: boolean; onChange: (v: unknown) => void }) {
  const b = (on: boolean, word: string) => (
    <button type="button" aria-pressed={value === on} className={`tap px-2.5 py-1 text-[12px] ${value === on ? "bg-dbs-blue/30 text-space-50" : "text-space-400"}`} onClick={() => onChange(value === on && optional ? undefined : on)}>
      {word}
    </button>
  );
  return (
    <span className={`inline-flex overflow-hidden rounded-lg border ${bad ? "border-dashed border-loss" : "border-space-600"}`}>
      {b(true, "yes")}
      {b(false, "no")}
    </span>
  );
}

/** "One of these": the conditions `any`/`all` join, each a block, indented. */
function CondList({ path }: { path: RulePath }) {
  const { rule, edit } = useBlocks();
  const conds = (resolvePath(rule, path) as Cond[] | undefined) ?? [];
  return (
    <div className="flex w-full flex-col gap-2 border-l-2 border-space-700 pl-2">
      {conds.map((_, i) => (
        <CondBlock key={i} path={childPath(path, i)} nested />
      ))}
      <Picker clause="cond" label="+ condition" onPick={(c) => edit((r) => insertAt(r, path, conds.length, blankCond(c.key as Cond["kind"])))} />
    </div>
  );
}

/** A "Choose one—": each option's words, and its own program. */
function ModesControl({ path }: { path: RulePath }) {
  const { rule, edit } = useBlocks();
  const modes = (resolvePath(rule, path) as { label: string; ops: Op[] }[] | undefined) ?? [];
  return (
    <div className="flex w-full flex-col gap-2 border-l-2 border-space-700 pl-2">
      {modes.map((m, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-center gap-1">
            <input value={m.label} placeholder="what the option says" onChange={(e) => edit((r) => setAt(r, childPath(path, i, "label"), e.target.value))} className={`${chip} min-w-0 flex-1`} />
            <button type="button" className={small} onClick={() => edit((r) => removeAt(r, childPath(path, i)))} aria-label="remove this option">
              ×
            </button>
          </div>
          <OpList path={childPath(path, i, "ops")} nested />
        </div>
      ))}
      <button type="button" className={addCls} onClick={() => edit((r) => insertAt(r, path, modes.length, { label: "", ops: [] }))}>
        + option
      </button>
    </div>
  );
}

// ── a ref, a selector, a filter, an amount ──────────────────────────────────

const refKey = (v: Loose | undefined): string => (!v ? "" : "var" in v ? `var:${v.var as string}` : (v.sel as Loose)?.special ? `special:${(v.sel as Loose).special as string}` : "sel");

/** What a target is: a name an earlier step bound (`$t`), a special target, or cards picked out by a selector. */
function RefControl({ value, path, optional, bad, onChange, rule }: { value: Loose | undefined; path: RulePath; optional: boolean; bad: boolean; onChange: (v: unknown) => void; rule: Rule }) {
  const bound = boundBefore(rule, path);
  const key = refKey(value);
  const names = value && "var" in value && !bound.includes(value.var as string) ? [...bound, value.var as string] : bound;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <select
        aria-label="which cards"
        value={key}
        className={`${chip} ${bad ? blankCls : ""}`}
        onChange={(e) => {
          const k = e.target.value;
          onChange(k === "" ? undefined : k.startsWith("var:") ? { var: k.slice(4) } : k === "sel" ? { sel: { count: 1 } } : { sel: { special: k.slice("special:".length) } });
        }}
      >
        {(optional || key === "") && <option value="">{optional ? "—" : "fill this"}</option>}
        {names.length > 0 && (
          <optgroup label="chosen earlier">
            {names.map((n) => (
              <option key={n} value={`var:${n}`}>
                ${n}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="a card by its place">
          {SELECTOR_SPECIALS.map((s) => (
            <option key={s} value={`special:${s}`}>
              [{s}]
            </option>
          ))}
        </optgroup>
        <option value="sel">cards matching…</option>
      </select>
      {value && "var" in value && value.minus !== undefined && <span className="font-mono text-[12px] text-space-400">MINUS ${value.minus as string}</span>}
      {key === "sel" && <SelectorBuilder value={value!.sel as Selector} path={childPath(path, "sel")} bad={false} onChange={(sel) => onChange({ sel })} rule={rule} />}
    </span>
  );
}

const HOW_WORDS: Record<HowMany, string> = { any: "any number", count: "exactly", upTo: "up to", take: "the top", all: "all" };

/** The selector as a query: `[how many] [which cards] IN [whose].[zone] [flags]`, with its reading under it. */
function SelectorBuilder({ value, path, bad, onChange, rule }: { value: Selector | undefined; path: RulePath; bad: boolean; onChange: (v: unknown) => void; rule: Rule }) {
  const [flagsOpen, setFlagsOpen] = useState(false);
  const sel: Selector = value ?? {};
  const how = howMany(sel);
  const set = (patch: Partial<Selector>) => {
    const next: Loose = { ...sel, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    onChange(next);
  };
  const vars = boundBefore(rule, path);
  if (sel.special)
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <select aria-label="special target" value={sel.special} className={chip} onChange={(e) => onChange(e.target.value ? { special: e.target.value } : {})}>
          <option value="">cards matching…</option>
          {SELECTOR_SPECIALS.map((s) => (
            <option key={s} value={s}>
              [{s}]
            </option>
          ))}
        </select>
      </span>
    );
  return (
    <div className={`w-full rounded-xl border p-2 ${bad || value === undefined ? "border-dashed border-loss" : "border-space-600"} bg-space-950/60`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <select aria-label="how many" value={how} className={chip} onChange={(e) => onChange(setHowMany(sel, e.target.value as HowMany))}>
          {(Object.keys(HOW_WORDS) as HowMany[]).map((h) => (
            <option key={h} value={h}>
              {HOW_WORDS[h]}
            </option>
          ))}
        </select>
        {(how === "count" || how === "upTo") && <Stepper value={sel.count} bad={false} label="how many" onChange={(n) => set({ count: n ?? 1 })} />}
        {how === "take" && <Stepper value={sel.take} bad={false} label="how many from the top" onChange={(n) => set({ take: n ?? 1 })} />}
        <select
          aria-label="which cards"
          value={sel.fromVar ? `var:${sel.fromVar}` : "cards"}
          className={chip}
          onChange={(e) => {
            const k = e.target.value;
            if (k.startsWith("special:")) onChange({ special: k.slice(8) });
            else set({ fromVar: k.startsWith("var:") ? k.slice(4) : undefined });
          }}
        >
          <option value="cards">cards</option>
          {vars.map((n) => (
            <option key={n} value={`var:${n}`}>
              among ${n}
            </option>
          ))}
          {SELECTOR_SPECIALS.map((s) => (
            <option key={s} value={`special:${s}`}>
              [{s}]
            </option>
          ))}
        </select>
        <FilterBuilder value={sel.filter} onChange={(f) => set({ filter: f as CardFilter | undefined })} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] font-bold text-space-400">IN</span>
        <Select value={sel.side ?? ""} options={optionsOf("side")} optional bad={false} label="whose" onChange={(w) => set({ side: (w || undefined) as Selector["side"] })} />
        <span className="text-space-500">.</span>
        {sel.areas ? (
          <Multi value={sel.areas} options={optionsOf("area")} bad={false} onChange={(a) => set({ areas: a.length ? (a as Selector["areas"]) : undefined })} />
        ) : (
          <Select value={sel.area ?? ""} options={optionsOf("area")} optional bad={false} label="zone" onChange={(w) => set({ area: (w || undefined) as Selector["area"] })} />
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {!flagsOpen && (
          <button type="button" className="tap rounded-full border border-space-700 px-2 py-0.5 text-[11px] text-space-400" onClick={() => setFlagsOpen(true)}>
            + flags
          </button>
        )}
        {SELECTOR_FLAG_WORDS.filter((w) => flagsOpen || flagOn(sel, w)).map((w) => {
          const on = flagOn(sel, w);
          return (
            <button key={w} type="button" aria-pressed={on} className={`tap rounded-full border px-2 py-0.5 text-[11px] ${on ? "border-dbs-blue bg-dbs-blue/25 text-space-50" : "border-space-700 text-space-500"}`} onClick={() => onChange(setFlag(sel, w, !on))}>
              {w}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[12px] text-space-400">
        <span className="text-space-500">reads: </span>
        {value === undefined ? <span className="text-loss">fill this</span> : selectorReading(sel) || "any card"}
      </p>
    </div>
  );
}

const FILTER_KEYS = Object.keys(FILTER_FIELDS) as (keyof CardFilter)[];

/** A filter, field by field over `FILTER_FIELDS`, read back with `describeFilter`. */
function FilterBuilder({ value, onChange }: { value: CardFilter | undefined; onChange: (v: unknown) => void }) {
  // A field just picked from "+ narrow…" still says nothing — no colour chosen,
  // no number — so the filter itself cannot show it yet; it is held here, as a
  // blank, until it is filled.
  const [picked, setPicked] = useState<(keyof CardFilter)[]>([]);
  const set = filterFieldsSet(value);
  const shown = [...set, ...picked.filter((k) => !set.includes(k))];
  const unset = FILTER_KEYS.filter((k) => !shown.includes(k));
  return (
    <span className="inline-flex w-full flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-space-700 p-1.5">
      <span className="text-[12px] text-space-300">{filterReading(value)}</span>
      {shown.map((k) => (
        <span key={k} className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-space-900 px-1.5 py-1">
          <span className="text-[11px] text-space-500">{fieldWords(k)}</span>
          <FilterValue type={FILTER_FIELDS[k]} value={value?.[k]} onChange={(v) => onChange(setFilterField(value, k, v))} />
          <button
            type="button"
            className="px-1 text-space-500 hover:text-loss"
            aria-label={`drop ${fieldWords(k)}`}
            onClick={() => {
              setPicked((p) => p.filter((x) => x !== k));
              onChange(setFilterField(value, k, undefined));
            }}
          >
            ×
          </button>
        </span>
      ))}
      <select
        aria-label="narrow the cards"
        value=""
        className={`${small} bg-transparent`}
        onChange={(e) => {
          const k = e.target.value as keyof CardFilter;
          if (!k) return;
          setPicked((p) => [...p, k]);
          onChange(setFilterField(value, k, blankFilterValue(FILTER_FIELDS[k])));
        }}
      >
        <option value="">+ narrow…</option>
        {unset.map((k) => (
          <option key={k} value={k}>
            {fieldWords(k)}
          </option>
        ))}
      </select>
    </span>
  );
}

function FilterValue({ type, value, onChange }: { type: FilterFieldType; value: unknown; onChange: (v: unknown) => void }) {
  const opts = filterOptions(type);
  switch (type) {
    case "colors":
    case "keywords":
      return <Multi value={(value as string[]) ?? []} options={opts ?? []} bad={!(value as string[])?.length} onChange={onChange} />;
    case "cardType":
    case "skillKind":
      return <Select value={(value as string) ?? ""} options={opts ?? []} optional={false} bad={value == null} label="value" onChange={(w) => onChange(w || null)} />;
    case "strings":
      return <Strings value={(value as string[]) ?? []} bad={!(value as string[])?.length} onChange={onChange} />;
    case "number":
      return <Stepper value={value as number | null} bad={value == null} label="value" onChange={(n) => onChange(n ?? null)} />;
    case "boolean":
      return <Toggle value={value as boolean} optional={false} bad={false} onChange={onChange} />;
    case "tri":
      return <Toggle value={value as boolean | undefined} optional bad={false} onChange={(v) => onChange(v ?? null)} />;
    case "powerRel": {
      const rel = (value as { of: string; cmp: string } | null) ?? { of: "self", cmp: "<=" };
      return (
        <span className="inline-flex gap-1">
          <Select value={rel.cmp} options={["<=", "<", ">=", ">"]} optional={false} bad={false} label="compared" onChange={(cmp) => onChange({ ...rel, cmp })} />
          <Select value={rel.of} options={["self", "chosen"]} optional={false} bad={false} label="against" onChange={(of) => onChange({ ...rel, of })} />
        </span>
      );
    }
  }
}

const AMOUNT_WORDS = (shape: string): string => {
  if (shape === "number") return "a number";
  if (shape === "var") return "a bound number ($)";
  if (shape === "plus") return "… plus N";
  const spec = exprSpec(shape);
  return spec ? spec.example.replace("SELECTOR", "…") : shape;
};

/** A number, or an expression from `EXPR_SCHEMA` behind "count(…)" and its kin. */
function AmountControl({ value, path, bad, onChange, rule }: { value: unknown; path: RulePath; bad: boolean; onChange: (v: unknown) => void; rule: Rule }) {
  const shape = value === undefined ? "number" : amountShape(value);
  const v = (typeof value === "object" && value ? value : {}) as Loose;
  const bound = boundBefore(rule, path);
  const spec = exprSpec(shape);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shape === "number" && <Stepper value={value as number | undefined} bad={bad} label="amount" onChange={onChange} />}
      <select aria-label="what kind of number" value={value === undefined ? "" : shape} className={`${small} bg-transparent`} onChange={(e) => onChange(e.target.value ? blankAmount(e.target.value, bound) : undefined)}>
        {value === undefined && <option value="">a number</option>}
        {AMOUNT_SHAPES.map((s) => (
          <option key={s} value={s}>
            {AMOUNT_WORDS(s)}
          </option>
        ))}
      </select>
      {shape === "var" && <Select value={v.var as string} options={[...new Set([...bound, v.var as string])]} optional={false} bad={false} label="bound name" onChange={(w) => onChange({ var: w })} />}
      {shape === "plus" && (
        <>
          <AmountControl value={(v.plus as unknown[])[0]} path={path} bad={false} onChange={(a) => onChange({ plus: [a, (v.plus as unknown[])[1]] })} rule={rule} />
          <span className="text-space-400">+</span>
          <Stepper value={(v.plus as number[])[1]} bad={false} label="plus" onChange={(n) => onChange({ plus: [(v.plus as unknown[])[0], n ?? 0] })} />
        </>
      )}
      {spec &&
        exprFields(spec).map((f, i) => {
          const arg = spec.args[i];
          const val = v[f];
          const put = (x: unknown) => onChange({ ...v, [f]: x });
          if (arg === "selector") return <SelectorBuilder key={f} value={val as Selector} path={path} bad={false} onChange={put} rule={rule} />;
          if (arg === "number") return <Stepper key={f} value={val as number} bad={false} label={f} onChange={(n) => put(n ?? 0)} />;
          if (arg === "side") return <Select key={f} value={val as string} options={optionsOf("side")} optional={false} bad={false} label="whose" onChange={put} />;
          if (arg === "attr") return <Select key={f} value={val as string} options={EXPR_ATTRS} optional={false} bad={false} label="which measure" onChange={put} />;
          if (arg === "var") return <Select key={f} value={(val as Loose)?.var as string} options={[...new Set([...bound, (val as Loose)?.var as string])]} optional={false} bad={false} label="bound name" onChange={(w) => put({ var: w })} />;
          return <RefControl key={f} value={val as Loose} path={path} optional={false} bad={false} onChange={put} rule={rule} />;
        })}
      {spec?.times && (
        <>
          <span className="text-space-400">×</span>
          <Stepper
            value={(v.times as number) ?? 1}
            bad={false}
            label="times"
            onChange={(n) => {
              const next = { ...v };
              if (n === undefined || n === 1) delete next.times;
              else next.times = n;
              onChange(next);
            }}
          />
        </>
      )}
    </span>
  );
}
