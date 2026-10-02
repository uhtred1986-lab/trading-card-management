"use client";

import { Children, createContext, isValidElement, useContext, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { EXPR_ATTRS, FILTER_FIELDS, type Rule } from "@/lib/arena/lang";
import type { FilterFieldType } from "@/lib/arena/lang/ast";
import {
  ALL,
  CLAUSE_WORDS,
  COST_ITEM_SPECS,
  EXPR_SPECS_SHAPES,
  NOUN_TYPES,
  SELECTOR_FLAG_WORDS,
  SELECTOR_SPECIALS,
  SIDE_WORDS,
  addCostItem,
  allBound,
  amountShape,
  areaWords,
  blankAmount,
  blankCond,
  blankFilterValue,
  blankOp,
  boundBefore,
  boundOf,
  boundWrite,
  choicesFor,
  condReading,
  controlFor,
  costItemReading,
  costItems,
  describeCostItem,
  describeNode,
  editCostItem,
  exprFields,
  exprSpec,
  fieldWords,
  filterFieldWords,
  filterFieldsSet,
  filterOptions,
  flagOn,
  howMany,
  insertAt,
  layoutOf,
  moveAt,
  nounWords,
  opReading,
  optionWords,
  optionsOf,
  problemsUnder,
  removeAt,
  searchChoices,
  selectValue,
  selectWrite,
  selectorReading,
  setAt,
  setFilterField,
  setFlag,
  setHowMany,
  triggerReading,
  whenChoices,
  type BoundCmp,
  type Choice,
  type CostItem,
  type CostSyntax,
  type HowMany,
  type Layout,
  type Problem,
} from "@/lib/arena/lang/blocks";
import { childPath, resolvePath, type RuleClause, type RulePath } from "@/lib/arena/lang/path";
import { COND_SCHEMA, OP_SCHEMA, type Cond, type Op, type OpField, type Selector } from "@/lib/arena/vm/script";
import type { CardFilter } from "@/lib/arena/text/filters";

/**
 * The block editor (#469): a rule as WHEN · COST · IF · THEN, each clause a
 * list of blocks, and each block **one plain sentence** — the row's own words,
 * as `describeScript`/`describeCond` say them — with its blanks standing in
 * the flow of the text as chips: "there are [3 ▾] [or more ▾] [blue ▾]
 * [cards ▾] in [your ▾] [Drop Area ▾]". Where each blank stands is worked out
 * by `layoutOf` (`lib/arena/lang/blocks.ts`) from the row's sentence, so a
 * row the schema gains lays itself out with no change here.
 *
 * Rare and optional fields wait behind each block's "More…"; a block that
 * holds blocks (`if`, `may`, `all`, `not`, …) shows them indented under its
 * sentence, one rule line, no boxes inside boxes.
 *
 * One component for the workbench record and the phone builder. Every edit
 * goes through a `RulePath` into the one `Rule` — the blocks never hold a
 * second copy of it, so blocks and the text view cannot disagree.
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

const TONE: Record<RuleClause, string> = { trigger: "text-ki-300", cost: "text-space-300", cond: "text-dbs-blue", ops: "text-ki-300" };

/** A blank, as a chip in the sentence: 44 px on a phone (`tap`), the value in the sentence's own words. */
const chip = "tap inline-flex max-w-full items-center rounded-lg border border-dbs-blue/60 bg-dbs-blue/15 px-2.5 py-1 text-[15px] font-semibold leading-tight text-space-50";
/** An empty required blank: a dashed "choose…". */
const blankChip = "border-dashed border-loss bg-loss/10 text-loss";
const small = "tap rounded px-2 py-1 text-[12px] font-semibold text-space-400 hover:text-space-100 disabled:opacity-30";
const addCls = "tap rounded-lg border border-dashed border-space-600 px-3 py-1.5 text-[13px] font-semibold text-space-300 hover:border-ki-500 hover:text-ki-300";
const words = "text-[15px] leading-relaxed text-space-100";

/** The words of the `<option>` with this value, found among a select's children (fragments and optgroups included). */
function optionText(children: ReactNode, value: string): string | null {
  for (const c of Children.toArray(children)) {
    if (!isValidElement(c)) continue;
    const props = c.props as { value?: unknown; children?: ReactNode };
    if (c.type === "option" && String(props.value ?? props.children) === value) return Children.toArray(props.children).join("");
    const inner = optionText(props.children, value);
    if (inner !== null) return inner;
  }
  return null;
}

/**
 * A native `<select>` as a chip as wide as the words it shows, not as its
 * longest choice — a plain select is, and a sentence of them wraps after every
 * blank. The words are laid out invisibly to give the chip its width, and the
 * select sits over them; on a phone the native list still opens.
 */
function Sel({ value, onChange, className = "", children, ...rest }: { value: string; onChange: (e: ChangeEvent<HTMLSelectElement>) => void; className?: string; children: ReactNode; "aria-label": string }) {
  const said = optionText(children, value) ?? value;
  return (
    <span className="relative inline-flex max-w-full rounded-lg focus-within:ring-2 focus-within:ring-ki-500">
      <span aria-hidden className={`${chip} ${className} max-w-full overflow-hidden text-ellipsis whitespace-nowrap pr-6`}>{said || " "}</span>
      <select {...rest} value={value} onChange={onChange} className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0">
        {children}
      </select>
      <span aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-space-400">
        ▾
      </span>
    </span>
  );
}

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

function useFocusScroll(focused: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focused]);
  return ref;
}

function Clause({ clause }: { clause: RuleClause }) {
  const { rule, edit, problems, focus } = useBlocks();
  const focused = focus === clause;
  const ref = useFocusScroll(focused);
  const empty = clause === "trigger" ? !rule.trigger.length : clause === "cost" ? !rule.cost : clause === "cond" ? !rule.cond : !rule.ops.length;

  return (
    <section ref={ref} data-path={clause} aria-label={CLAUSE_WORDS[clause]} className={`rounded-2xl border bg-space-900/60 px-3 py-2.5 ${focused ? "border-ki-500 ring-2 ring-ki-500/40" : "border-space-700"}`}>
      <header className="flex items-baseline gap-2">
        <h3 className={`text-[12px] font-bold tracking-[0.14em] ${TONE[clause]}`}>{CLAUSE_WORDS[clause]}</h3>
        {clause === "trigger" && <span className="rounded bg-space-800 px-1.5 py-0.5 font-mono text-[11px] text-space-300" title="the printed skill tag comes off the card and cannot be edited">[{rule.kind}]</span>}
        {empty && <span className="text-[12px] text-space-500">{clause === "cond" ? "always — no condition" : clause === "cost" ? "no price" : clause === "trigger" ? "no moment named" : "does nothing yet"}</span>}
      </header>
      {own(problems, clause).map((p) => (
        <p key={p.message} className="mt-1 text-[12px] text-loss">
          {p.message}
        </p>
      ))}
      <div className="divide-y divide-space-700/70">
        {clause === "trigger" && rule.trigger.map((t, i) => <TriggerRow key={`${t}-${i}`} index={i} />)}
        {clause === "cost" && costItems(rule.cost).map((item, i) => <CostItemBlock key={`${item.path}-${i}`} item={item} index={i} />)}
        {clause === "cond" && rule.cond && <CondBlock path="cond" onRemove={() => edit((r) => ({ ...r, cond: null }))} />}
        {clause === "ops" && rule.ops.map((_, i) => <OpBlock key={i} path={`ops[${i}]`} />)}
      </div>
      {clause === "trigger" && <Picker clause="trigger" label="+ add a moment" onPick={(c) => edit((r) => (r.trigger.includes(c.key as Rule["trigger"][number]) ? r : { ...r, trigger: [...r.trigger, c.key as Rule["trigger"][number]] }))} />}
      {clause === "cost" && <CostPicker />}
      {clause === "cond" && !rule.cond && <Picker clause="cond" label="+ add a condition" onPick={(c) => edit((r) => ({ ...r, cond: blankCond(c.key as Cond["kind"]) }))} />}
      {clause === "ops" && <Picker clause="ops" label="+ add a step" onPick={(c) => edit((r) => insertAt(r, "ops", r.ops.length, blankOp(c.key as Op["op"], allBound(r))))} />}
    </section>
  );
}

/** A WHEN moment is one chip of the game's moments, in their own words. */
function TriggerRow({ index }: { index: number }) {
  const { rule, edit, problems, focus } = useBlocks();
  const path = `trigger[${index}]`;
  const t = rule.trigger[index];
  const ref = useFocusScroll(focus === path);
  const moments = whenChoices();
  return (
    <div ref={ref} data-path={path} className={`flex flex-wrap items-center gap-1.5 py-2 ${focus === path ? "rounded-lg bg-ki-500/10" : ""}`}>
      <Sel
        aria-label="the moment"
        value={t}
        className={own(problems, path).length ? blankChip : ""}
        onChange={(e) => edit((r) => ({ ...r, trigger: r.trigger.map((x, i) => (i === index ? (e.target.value as Rule["trigger"][number]) : x)) }))}
      >
        {!moments.some((m) => m.key === t) && <option value={t}>{triggerReading(t)}</option>}
        {moments.map((m) => (
          <option key={m.key} value={m.key}>
            {m.label}
          </option>
        ))}
      </Sel>
      <button type="button" className={`${small} ml-auto hover:text-loss`} aria-label="remove this moment" onClick={() => edit((r) => removeAt(r, path))}>
        ×
      </button>
      {own(problems, path).map((p) => (
        <p key={p.message} className="w-full text-[12px] text-loss">
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
        <input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`search ${all.length} ${clause === "ops" ? "steps" : clause === "cond" ? "conditions" : clause === "cost" ? "price items" : "moments"}`} className="tap min-w-0 flex-1 rounded-lg border border-space-600 bg-space-900 px-2 text-[15px] text-space-100" />
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
                    <span className="text-[15px] text-space-100">{c.label}</span>
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

// ── one block: its sentence, its "More…", the blocks it holds ───────────────

interface BlockViewProps {
  path: RulePath;
  /** The row's key, shown in "More…" — the sentence does not need it. */
  rowKey: string;
  node: Loose;
  fields: readonly OpField[];
  describe: (n: Loose) => string;
  template: unknown;
  name?: string;
  /** Where a blank of this block lives, by field name (a price item's blanks all live at the item's own path). */
  pathOf: (field: string) => RulePath;
  onSet: (patch: Loose) => void;
  onRemove: () => void;
  onMove?: (by: number) => void;
  nested?: (field: string) => ReactNode;
  /** The reading under the sentence: only shown when it says something the sentence does not. */
  reading: string;
}

function BlockView({ path, rowKey, node, fields, describe, template, name, pathOf, onSet, onRemove, onMove, nested, reading }: BlockViewProps) {
  const { problems, focus, rule } = useBlocks();
  const [more, setMore] = useState(false);
  const focused = focus === path;
  const ref = useFocusScroll(focused);
  const layout: Layout = layoutOf(node, fields, describe, template, name);
  const byName = new Map(fields.map((f) => [f.name, f]));
  const moreSet = layout.more.filter((n) => node[n] !== undefined);
  const inside = problemsUnder(problems, path);
  // A problem the sentence cannot point at — the block's own, or a blank behind "More…".
  const shownHere = new Set(layout.pieces.flatMap((p) => ("field" in p ? [pathOf(p.field)] : [])));
  const loose = inside.filter((p) => p.path === path || (layout.more.some((n) => pathOf(n) === p.path) && !shownHere.has(p.path)));

  const blank = (f: OpField) => {
    const v = node[f.name];
    const labels = controlFor(f.type) === "select" || controlFor(f.type) === "toggle" ? labelsFor(node, fields, f, describe, layout) : undefined;
    return <FieldChip key={f.name} field={f} value={v} path={pathOf(f.name)} labels={labels} onChange={(x) => onSet({ [f.name]: x })} rule={rule} inCond={!("op" in node)} />;
  };

  return (
    <div ref={ref} data-path={path} className={`py-2 ${focused ? "-mx-1.5 rounded-lg bg-ki-500/10 px-1.5 ring-1 ring-ki-500/50" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
        {layout.pieces.map((p, i) =>
          "text" in p ? (
            <span key={`t${i}`} className={words}>
              {p.text}
            </span>
          ) : "bound" in p ? (
            <BoundChip key="bound" node={node} bad={inside.some((x) => x.path === pathOf("atLeast") || x.path === pathOf("atMost"))} onSet={onSet} />
          ) : byName.get(p.field) ? (
            blank(byName.get(p.field)!)
          ) : null,
        )}
        <button type="button" aria-expanded={more} className={`${small} ml-auto`} onClick={() => setMore(!more)}>
          {more ? "Less" : "More…"}
        </button>
      </div>
      {(layout.fallback || moreSet.some((n) => n !== "as")) && reading && (
        <p className="mt-1 text-[12px] text-space-400">
          <span className="text-space-500">reads: </span>
          {reading}
        </p>
      )}
      {loose.map((p) => (
        <p key={`${p.path}-${p.message}`} className="mt-1 text-[12px] text-loss">
          {p.path === path ? "" : `${fieldWords(p.path.split(/[.[\]]+/).filter(Boolean).pop() ?? "")}: `}
          {p.message}
        </p>
      ))}
      {more && (
        <div className="mt-2 space-y-2 rounded-xl border border-space-700 bg-space-950/60 p-2">
          <div className="text-[11px] text-space-500">
            <span className="font-mono">{rowKey}</span> — the rest of what this block can say
          </div>
          {layout.more.map((n) => (
            <div key={n} className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-space-400">{fieldWords(n)}</span>
              {blank(byName.get(n)!)}
              {node[n] !== undefined && !byName.get(n)!.required && (
                <button type="button" className={small} onClick={() => onSet({ [n]: undefined })} aria-label={`clear ${fieldWords(n)}`}>
                  clear
                </button>
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-1 border-t border-space-700 pt-2">
            {onMove && (
              <>
                <button type="button" className={small} onClick={() => onMove(-1)}>
                  ↑ earlier
                </button>
                <button type="button" className={small} onClick={() => onMove(1)}>
                  ↓ later
                </button>
              </>
            )}
            <button type="button" className={`${small} text-loss`} onClick={onRemove}>
              remove this block
            </button>
          </div>
        </div>
      )}
      {nested &&
        layout.nested.map((n) => (
          <div key={n} className="mt-1 ml-1 border-l-2 border-space-600 pl-3">
            {layout.nested.length > 1 && <div className="pt-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-space-500">{fieldWords(n)}</div>}
            {nested(n)}
          </div>
        ))}
    </div>
  );
}

/** The words each choice of a closed list reads as in this sentence. */
function labelsFor(node: Loose, fields: readonly OpField[], f: OpField, describe: (n: Loose) => string, layout: Layout): Record<string, string> {
  // "" is the field left out: what the sentence says when nothing is chosen (a step's side unset reads "draw").
  if (controlFor(f.type) === "toggle") return optionWords(node, fields, f.name, ["", "yes", "no"], describe, (o) => (o === "" ? undefined : o === "yes"), layout);
  return optionWords(node, fields, f.name, ["", ...optionsOf(f.type)], describe, (o) => selectWrite(f.type, o), layout);
}

// ── the three kinds of block ────────────────────────────────────────────────

function OpBlock({ path }: { path: RulePath }) {
  const { rule, edit, permanent } = useBlocks();
  const op = resolvePath(rule, path) as Op;
  const spec = OP_SCHEMA[op.op];
  const node = op as unknown as Loose;
  return (
    <BlockView
      path={path}
      rowKey={op.op}
      node={node}
      fields={spec.fields}
      describe={describeNode("op")}
      template={spec.sentence}
      pathOf={(f) => childPath(path, f)}
      onSet={(patch) => edit((r) => Object.entries(patch).reduce((acc, [k, v]) => setAt(acc, childPath(path, k), v), r))}
      onRemove={() => edit((r) => removeAt(r, path))}
      onMove={(by) => edit((r) => moveAt(r, path, by))}
      reading={opReading(op, permanent)}
      nested={(f) => <Nested field={spec.fields.find((x) => x.name === f)!} path={childPath(path, f)} />}
    />
  );
}

function CondBlock({ path, onRemove }: { path: RulePath; onRemove?: () => void }) {
  const { rule, edit } = useBlocks();
  const cond = resolvePath(rule, path) as Cond | undefined;
  if (!cond) return <Picker clause="cond" label="+ condition" onPick={(c) => edit((r) => setAt(r, path, blankCond(c.key as Cond["kind"])))} />;
  const spec = COND_SCHEMA[cond.kind];
  return (
    <BlockView
      path={path}
      rowKey={cond.kind}
      node={cond as unknown as Loose}
      fields={spec.fields}
      describe={describeNode("kind")}
      template={null}
      pathOf={(f) => childPath(path, f)}
      onSet={(patch) => edit((r) => Object.entries(patch).reduce((acc, [k, v]) => setAt(acc, childPath(path, k), v), r))}
      onRemove={onRemove ?? (() => edit((r) => removeAt(r, path)))}
      reading={condReading(cond)}
      nested={(f) => <Nested field={spec.fields.find((x) => x.name === f)!} path={childPath(path, f)} />}
    />
  );
}

const COST_NAMES: Partial<Record<CostSyntax, string>> = { IF: "if", DO: "and do", X: "X energy" };

function CostItemBlock({ item, index }: { item: CostItem; index: number }) {
  const { edit } = useBlocks();
  const spec = COST_ITEM_SPECS[item.key];
  const write = (values: Loose | null) =>
    edit((r) => {
      const cost = editCostItem(r.cost, index, values);
      return { ...r, cost: costItems(cost).length || values !== null ? cost : null };
    });
  return (
    <BlockView
      path={item.path}
      rowKey={item.key}
      node={item.values}
      fields={spec.fields}
      describe={describeCostItem(item.key)}
      template={null}
      name={COST_NAMES[item.key] ?? item.key}
      pathOf={() => item.path}
      onSet={(patch) => write({ ...item.values, ...patch })}
      onRemove={() => write(null)}
      reading={costItemReading(item)}
      // A price's condition and program live at the item's own path (`cost.condition`, `cost.program`).
      nested={(f) => (spec.fields.find((x) => x.name === f)?.type === "cond" ? <CondBlock path={item.path} onRemove={() => write(null)} /> : <OpList path={item.path} />)}
    />
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

/** What a block holds: a condition, a list of them, a program, or a modal's options — indented under it. */
function Nested({ field, path }: { field: OpField; path: RulePath }) {
  const { rule, edit } = useBlocks();
  switch (controlFor(field.type)) {
    case "cond":
      return resolvePath(rule, path) === undefined ? <Picker clause="cond" label="+ condition" onPick={(c) => edit((r) => setAt(r, path, blankCond(c.key as Cond["kind"])))} /> : <CondBlock path={path} onRemove={field.required ? undefined : () => edit((r) => setAt(r, path, undefined))} />;
    case "conds":
      return <CondList path={path} />;
    case "ops":
      return <OpList path={path} />;
    case "modes":
      return <ModesControl path={path} />;
    default:
      return null;
  }
}

function OpList({ path }: { path: RulePath }) {
  const { rule, edit } = useBlocks();
  const ops = (resolvePath(rule, path) as Op[] | undefined) ?? [];
  return (
    <div>
      <div className="divide-y divide-space-700/50">
        {ops.map((_, i) => (
          <OpBlock key={i} path={childPath(path, i)} />
        ))}
      </div>
      <Picker clause="ops" label="+ step" onPick={(c) => edit((r) => insertAt(r, path, ops.length, blankOp(c.key as Op["op"], allBound(r))))} />
    </div>
  );
}

function CondList({ path }: { path: RulePath }) {
  const { rule, edit } = useBlocks();
  const conds = (resolvePath(rule, path) as Cond[] | undefined) ?? [];
  return (
    <div>
      <div className="divide-y divide-space-700/50">
        {conds.map((_, i) => (
          <CondBlock key={i} path={childPath(path, i)} />
        ))}
      </div>
      <Picker clause="cond" label="+ condition" onPick={(c) => edit((r) => insertAt(r, path, conds.length, blankCond(c.key as Cond["kind"])))} />
    </div>
  );
}

/** A "Choose one—": each option's words, and its own program under them. */
function ModesControl({ path }: { path: RulePath }) {
  const { rule, edit } = useBlocks();
  const modes = (resolvePath(rule, path) as { label: string; ops: Op[] }[] | undefined) ?? [];
  return (
    <div className="space-y-2">
      {modes.map((m, i) => (
        <div key={i}>
          <div className="flex items-center gap-1">
            <span className={words}>・</span>
            <input value={m.label} placeholder="what the option says" onChange={(e) => edit((r) => setAt(r, childPath(path, i, "label"), e.target.value))} className={`${chip} min-w-0 flex-1 font-normal`} />
            <button type="button" className={`${small} hover:text-loss`} onClick={() => edit((r) => removeAt(r, childPath(path, i)))} aria-label="remove this option">
              ×
            </button>
          </div>
          <div className="ml-1 border-l-2 border-space-700 pl-3">
            <OpList path={childPath(path, i, "ops")} />
          </div>
        </div>
      ))}
      <button type="button" className={addCls} onClick={() => edit((r) => insertAt(r, path, modes.length, { label: "", ops: [] }))}>
        + option
      </button>
    </div>
  );
}

// ── a blank, by its field type ──────────────────────────────────────────────

function FieldChip({ field, value, path, labels, onChange, rule, inCond }: { field: OpField; value: unknown; path: RulePath; labels?: Record<string, string>; onChange: (v: unknown) => void; rule: Rule; inCond: boolean }) {
  const { problems } = useBlocks();
  const bad = own(problems, path).length > 0 || (!!field.required && value === undefined);
  const t = field.type;
  switch (controlFor(t)) {
    case "select":
      return <SelectChip label={field.name} value={selectValue(t, value)} options={optionsOf(t)} labels={labels} optional={!field.required} bad={bad} onChange={(w) => onChange(selectWrite(t, w))} />;
    case "toggle":
      return <SelectChip label={field.name} value={value === undefined ? "" : value ? "yes" : "no"} options={["yes", "no"]} labels={labels} optional={!field.required} bad={bad} onChange={(w) => onChange(w === "" ? undefined : w === "yes")} />;
    case "multi":
      return <MultiChip value={(value as string[]) ?? []} options={optionsOf(t)} bad={bad} onChange={(v) => onChange(v.length || field.required ? v : undefined)} />;
    case "strings":
      return <StringsChip value={(value as string[]) ?? []} bad={bad} onChange={(v) => onChange(v.length || field.required ? v : undefined)} />;
    case "number":
      return <NumberChip label={field.name} value={value as number | null | undefined} bad={bad} onChange={(n) => onChange(n === undefined ? (field.nullable ? null : undefined) : n)} />;
    case "text":
      return <input aria-label={field.name} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || (field.required ? "" : undefined))} className={`${chip} w-36 font-normal ${bad ? blankChip : ""}`} placeholder="choose…" />;
    case "amount":
      return <AmountChip value={value} path={path} bad={bad} onChange={onChange} rule={rule} />;
    case "filter":
      return <FilterPhrase value={value as CardFilter | undefined} onChange={onChange} />;
    case "selector":
      return <SelectorPhrase value={value as Selector | undefined} path={path} bad={bad} onChange={onChange} rule={rule} inCond={inCond} />;
    case "ref":
      return <RefChip value={value as Loose | undefined} path={path} optional={!field.required} bad={bad} onChange={onChange} rule={rule} />;
    default:
      return null;
  }
}

/** A closed list as a chip; its choices in the sentence's own words when the sentence says them. */
function SelectChip({ label, value, options, labels, optional, bad, onChange }: { label: string; value: string; options: readonly string[]; labels?: Record<string, string>; optional: boolean; bad: boolean; onChange: (w: string) => void }) {
  return (
    <Sel aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={bad ? blankChip : ""}>
      {(optional || value === "") && <option value="">{optional ? labels?.[""] || "—" : "choose…"}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {labels?.[o] ?? o}
        </option>
      ))}
    </Sel>
  );
}

/** A chip that opens a sheet: for a pick of several (colours), or a blank with more to it than one list. */
function SheetChip({ label, bad, title, children, startOpen = false }: { label: ReactNode; bad?: boolean; title: string; children: ReactNode; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <>
      <button type="button" aria-haspopup="dialog" className={`${chip} ${bad ? blankChip : ""}`} onClick={() => setOpen(true)}>
        {label} <span className="ml-1 text-[11px] text-space-400">▾</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-label={title}>
          <button type="button" aria-label="close" className="absolute inset-0 bg-space-950/70" onClick={() => setOpen(false)} />
          <div className="relative max-h-[75vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-space-600 bg-space-900 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-2xl">
            <div className="mb-3 flex items-center">
              <h4 className="text-[13px] font-bold uppercase tracking-[0.12em] text-space-300">{title}</h4>
              <button type="button" className={`${addCls} ml-auto`} onClick={() => setOpen(false)}>
                Done
              </button>
            </div>
            {children}
          </div>
        </div>
      )}
    </>
  );
}

function Toggles({ value, options, onChange }: { value: string[]; options: readonly string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button key={o} type="button" aria-pressed={on} className={`tap rounded-lg border px-3 py-1.5 text-[14px] ${on ? "border-dbs-blue bg-dbs-blue/25 text-space-50" : "border-space-600 text-space-400"}`} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}>
            {o}
          </button>
        );
      })}
    </div>
  );
}

function MultiChip({ value, options, bad, onChange }: { value: string[]; options: readonly string[]; bad: boolean; onChange: (v: string[]) => void }) {
  return (
    <SheetChip label={value.length ? value.join(" or ") : "choose…"} bad={bad || !value.length} title="choose any of these">
      <Toggles value={value} options={options} onChange={onChange} />
    </SheetChip>
  );
}

function StringsChip({ value, bad, onChange }: { value: string[]; bad: boolean; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(", "));
  return <input value={text} placeholder="choose…" aria-label="names" onChange={(e) => setText(e.target.value)} onBlur={() => onChange(text.split(",").map((s) => s.trim()).filter(Boolean))} className={`${chip} w-36 font-normal ${bad ? blankChip : ""}`} />;
}

const NUMBERS = Array.from({ length: 11 }, (_, i) => i);

/** A number as a chip of the small ones a card prints, and "other…" for the rest. */
function NumberChip({ label, value, bad, onChange, extra = [] }: { label: string; value: number | null | undefined; bad: boolean; onChange: (n: number | undefined) => void; extra?: { value: string; label: string }[] }) {
  const [typing, setTyping] = useState(false);
  const n = typeof value === "number" ? value : null;
  if (typing || (n !== null && n > 10 && n !== ALL))
    return <input aria-label={label} inputMode="numeric" autoFocus={typing} value={n ?? ""} placeholder="?" onChange={(e) => onChange(e.target.value.trim() === "" || Number.isNaN(Number(e.target.value)) ? undefined : Number(e.target.value))} onBlur={() => setTyping(false)} className={`${chip} w-20 ${bad ? blankChip : ""}`} />;
  return (
    <Sel
      aria-label={label}
      value={n === null ? "" : String(n)}
      className={bad ? blankChip : ""}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "other") setTyping(true);
        else if (v === "") onChange(undefined);
        else if (extra.some((x) => x.value === v)) onChange(v as unknown as number);
        else onChange(Number(v));
      }}
    >
      {n === null && <option value="">choose…</option>}
      {NUMBERS.map((x) => (
        <option key={x} value={String(x)}>
          {x}
        </option>
      ))}
      {extra.map((x) => (
        <option key={x.value} value={x.value}>
          {x.label}
        </option>
      ))}
      <option value="other">other…</option>
    </Sel>
  );
}

const BOUND_WORDS: Record<BoundCmp, string> = { any: "any", atLeast: "or more", atMost: "or fewer", exactly: "exactly" };

/** `atLeast`/`atMost` as the sentence says them: "[3 ▾] [or more ▾]", or "[any ▾]". */
function BoundChip({ node, bad, onSet }: { node: Loose; bad: boolean; onSet: (patch: Loose) => void }) {
  const { cmp, n } = boundOf(node);
  const write = (c: BoundCmp, v: number | null) => onSet({ atLeast: undefined, atMost: undefined, ...boundWrite(c, v) });
  return (
    <>
      {cmp !== "any" && <NumberChip label="how many" value={n} bad={bad} onChange={(v) => write(cmp, v ?? 0)} />}
      <Sel aria-label="compared how" value={cmp} className={bad ? blankChip : ""} onChange={(e) => write(e.target.value as BoundCmp, n)}>
        {(Object.keys(BOUND_WORDS) as BoundCmp[]).map((c) => (
          <option key={c} value={c}>
            {BOUND_WORDS[c]}
          </option>
        ))}
      </Sel>
    </>
  );
}

// ── a ref, a selector, a filter, an amount ──────────────────────────────────

const refKey = (v: Loose | undefined): string => (!v ? "" : "var" in v ? `var:${v.var as string}` : (v.sel as Loose)?.special ? `special:${(v.sel as Loose).special as string}` : "sel");
const specialWords = (s: string): string => selectorReading({ special: s as Selector["special"] }) || s;

/** What a target is: what an earlier step chose (`$t`), a card by its place, or cards picked out here. */
function RefChip({ value, path, optional, bad, onChange, rule }: { value: Loose | undefined; path: RulePath; optional: boolean; bad: boolean; onChange: (v: unknown) => void; rule: Rule }) {
  const bound = boundBefore(rule, path);
  const key = refKey(value);
  const names = value && "var" in value && !bound.includes(value.var as string) ? [...bound, value.var as string] : bound;
  return (
    <>
      <Sel
        aria-label="which cards"
        value={key}
        className={bad ? blankChip : ""}
        onChange={(e) => {
          const k = e.target.value;
          onChange(k === "" ? undefined : k.startsWith("var:") ? { var: k.slice(4) } : k === "sel" ? { sel: { count: 1 } } : { sel: { special: k.slice("special:".length) } });
        }}
      >
        {(optional || key === "") && <option value="">{optional ? "—" : "choose…"}</option>}
        {names.map((n) => (
          <option key={n} value={`var:${n}`}>
            the chosen card{n === "t" ? "" : ` ($${n})`}
          </option>
        ))}
        {SELECTOR_SPECIALS.map((s) => (
          <option key={s} value={`special:${s}`}>
            {specialWords(s)}
          </option>
        ))}
        <option value="sel">cards matching…</option>
      </Sel>
      {value && "var" in value && value.minus !== undefined && <span className={words}>other than ${value.minus as string}</span>}
      {key === "sel" && <SelectorPhrase value={value!.sel as Selector} path={childPath(path, "sel")} bad={false} onChange={(sel) => onChange({ sel })} rule={rule} inCond={false} />}
    </>
  );
}

/** How many, as one chip: a choice of N, up to N, the top N, all, or nothing said. */
function howManyValue(sel: Selector): string {
  const how = howMany(sel);
  if (how === "count") return `count:${sel.count}`;
  if (how === "upTo") return `upTo:${sel.count}`;
  if (how === "take") return `take:${sel.take}${sel.fromEnd ? ":end" : ""}`;
  return how;
}
const HOW_OPTIONS = (sel: Selector): { value: string; label: string }[] => {
  const out = [
    { value: "any", label: "any number of" },
    ...NUMBERS.slice(1, 7).map((n) => ({ value: `count:${n}`, label: String(n) })),
    ...NUMBERS.slice(1, 5).map((n) => ({ value: `upTo:${n}`, label: `up to ${n}` })),
    ...NUMBERS.slice(1, 4).map((n) => ({ value: `take:${n}`, label: `the top ${n}` })),
    ...NUMBERS.slice(1, 3).map((n) => ({ value: `take:${n}:end`, label: `the bottom ${n}` })),
    { value: "all", label: "all" },
  ];
  const cur = howManyValue(sel);
  if (!out.some((o) => o.value === cur)) out.push({ value: cur, label: cur.replace(/^count:/, "").replace(/^upTo:/, "up to ").replace(/^take:(\d+):end/, "the bottom $1").replace(/^take:/, "the top ") });
  return out;
};
function writeHowMany(sel: Selector, v: string): Selector {
  const [how, n, end] = v.split(":");
  const next = setHowMany(sel, how as HowMany);
  if (how === "count" || how === "upTo") next.count = Number(n);
  if (how === "take") {
    next.take = Number(n);
    if (end) next.fromEnd = true;
  }
  return next;
}

/**
 * A selector as a phrase: `[how many] [blue ▾] [Battle Cards ▾] in [your ▾]
 * [Drop Area ▾]`, its flags as chips once set, and the rest behind "…".
 */
function SelectorPhrase({ value, path, bad, onChange, rule, inCond }: { value: Selector | undefined; path: RulePath; bad: boolean; onChange: (v: unknown) => void; rule: Rule; inCond: boolean }) {
  // The filter's newly picked blanks are held here, so its "+ narrow…" can stand at the end of the phrase.
  const picks = useState<(keyof CardFilter)[]>([]);
  if (value === undefined)
    return (
      <button type="button" className={`${chip} ${blankChip}`} onClick={() => onChange(inCond ? {} : { count: 1 })}>
        which cards…
      </button>
    );
  const sel = value;
  const set = (patch: Partial<Selector>) => {
    const next: Loose = { ...sel, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    onChange(next);
  };
  if (sel.special)
    return (
      <Sel aria-label="which card" value={sel.special} onChange={(e) => onChange(e.target.value ? { special: e.target.value } : { count: 1 })}>
        {SELECTOR_SPECIALS.map((s) => (
          <option key={s} value={s}>
            {specialWords(s)}
          </option>
        ))}
        <option value="">cards matching…</option>
      </Sel>
    );
  const vars = boundBefore(rule, path);
  const how = howMany(sel);
  const sideWords = { "": "any player's", ...SIDE_WORDS };
  return (
    <>
      {how !== "any" && (
        <Sel aria-label="how many" value={howManyValue(sel)} onChange={(e) => onChange(writeHowMany(sel, e.target.value))}>
          {HOW_OPTIONS(sel).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Sel>
      )}
      {sel.fromVar && <span className={words}>of ${sel.fromVar}:</span>}
      <FilterPhrase value={sel.filter} onChange={(f) => set({ filter: f as CardFilter | undefined })} picks={picks} narrow={false} />
      <span className={words}>in</span>
      <SelectChip label="whose" value={sel.side ?? ""} options={Object.keys(SIDE_WORDS)} labels={sideWords} optional bad={false} onChange={(w) => set({ side: (w || undefined) as Selector["side"] })} />
      {sel.areas ? (
        <MultiChip value={sel.areas} options={optionsOf("area")} bad={!sel.areas.length} onChange={(a) => set({ areas: a.length ? (a as Selector["areas"]) : undefined })} />
      ) : (
        <SelectChip label="zone" value={sel.area ?? ""} options={optionsOf("area")} labels={{ "": "any zone", ...Object.fromEntries(optionsOf("area").map((a) => [a, areaWords(a)])) }} optional bad={bad && !sel.area} onChange={(w) => set({ area: (w || undefined) as Selector["area"] })} />
      )}
      {SELECTOR_FLAG_WORDS.filter((w) => flagOn(sel, w)).map((w) => (
        <button key={w} type="button" className={chip} onClick={() => onChange(setFlag(sel, w, false))} aria-label={`drop ${w}`}>
          {fieldWords(w)} ×
        </button>
      ))}
      <NarrowPicker value={sel.filter} onChange={(f) => set({ filter: f as CardFilter | undefined })} picks={picks} />
      <SheetChip label="…" title="more about these cards">
        <div className="space-y-3 text-[13px] text-space-300">
          <label className="flex flex-wrap items-center gap-2">
            how many
            <Sel aria-label="how many (all choices)" value={howManyValue(sel)} onChange={(e) => onChange(writeHowMany(sel, e.target.value))}>
              {HOW_OPTIONS(sel).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Sel>
          </label>
          {vars.length > 0 && (
            <label className="flex flex-wrap items-center gap-2">
              from among
              <SelectChip label="from among" value={sel.fromVar ?? ""} options={vars} labels={{ "": "the zone", ...Object.fromEntries(vars.map((v) => [v, `$${v}`])) }} optional bad={false} onChange={(w) => set({ fromVar: w || undefined })} />
            </label>
          )}
          <div>
            <div className="mb-1">which of them</div>
            <Toggles value={SELECTOR_FLAG_WORDS.filter((w) => flagOn(sel, w))} options={SELECTOR_FLAG_WORDS} onChange={(on) => onChange(SELECTOR_FLAG_WORDS.reduce((s, w) => setFlag(s, w, on.includes(w)), sel))} />
          </div>
          <button type="button" className={addCls} onClick={() => onChange({ special: "self" })}>
            a card by its place instead…
          </button>
        </div>
      </SheetChip>
    </>
  );
}

const FILTER_KEYS = Object.keys(FILTER_FIELDS) as (keyof CardFilter)[];
/** The noun is `type`'s chip, not a field chip of its own. */
const NOUN_KEYS = new Set<keyof CardFilter>(["type"]);

/**
 * A filter as the words of a phrase: `[blue ▾] [Battle Cards ▾] [with an energy
 * cost of 4 or less ▾]` — each set field a chip in its own words (off
 * `describeFilter`), the noun `type`'s chip, and "+ narrow…" for the rest.
 */
type Picked = [(keyof CardFilter)[], (fn: (p: (keyof CardFilter)[]) => (keyof CardFilter)[]) => void];

function FilterPhrase({ value, onChange, picks, narrow = true }: { value: CardFilter | undefined; onChange: (v: unknown) => void; picks?: Picked; narrow?: boolean }) {
  // A field just picked from "+ narrow…" still says nothing — no colour chosen,
  // no number — so the filter itself cannot show it yet; it is held here (or by
  // the selector the filter is part of), as a blank, with its sheet open, until it is filled.
  const ownPicks = useState<(keyof CardFilter)[]>([]);
  const [picked, setPicked] = picks ?? ownPicks;
  const set = filterFieldsSet(value);
  const shown = [...set, ...picked.filter((k) => !set.includes(k))].filter((k) => !NOUN_KEYS.has(k));
  const chipOf = (k: keyof CardFilter) => {
    const v = value?.[k];
    const empty = !set.includes(k);
    const said = empty ? fieldWords(k) : filterFieldWords(k, v).words;
    return (
      <SheetChip key={k} label={empty ? `${said}: choose…` : said} bad={empty} title={fieldWords(k)} startOpen={empty}>
        <FilterValue type={FILTER_FIELDS[k]} value={v} onChange={(x) => onChange(setFilterField(value, k, x))} />
        <button
          type="button"
          className={`${addCls} mt-3 text-loss`}
          onClick={() => {
            setPicked((p) => p.filter((x) => x !== k));
            onChange(setFilterField(value, k, undefined));
          }}
        >
          drop this
        </button>
      </SheetChip>
    );
  };
  const before = shown.filter((k) => !filterFieldWords(k, value?.[k] ?? blankFilterValue(FILTER_FIELDS[k])).after);
  const after = shown.filter((k) => !before.includes(k));
  return (
    <>
      {before.map(chipOf)}
      <Sel
        aria-label="what kind of card"
        value={value?.type ?? ""}
        onChange={(e) => onChange(setFilterField(value, "type", e.target.value || undefined))}
      >
        <option value="">{nounWords(null, value?.notType ?? null)}</option>
        {NOUN_TYPES.map((t) => (
          <option key={t} value={t}>
            {nounWords(t)}
          </option>
        ))}
      </Sel>
      {after.map(chipOf)}
      {narrow && <NarrowPicker value={value} onChange={onChange} picks={[picked, setPicked]} />}
    </>
  );
}

/** "+ narrow…": every filter field the phrase does not say yet, by its own name (`FILTER_FIELDS`). */
function NarrowPicker({ value, onChange, picks: [picked, setPicked] }: { value: CardFilter | undefined; onChange: (v: unknown) => void; picks: Picked }) {
  const set = filterFieldsSet(value);
  const unset = FILTER_KEYS.filter((k) => !set.includes(k) && !picked.includes(k) && !NOUN_KEYS.has(k));
  return (
    <Sel
      aria-label="narrow the cards"
      value=""
      className="border-dashed border-space-600 bg-transparent font-normal text-space-300"
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
    </Sel>
  );
}

function FilterValue({ type, value, onChange }: { type: FilterFieldType; value: unknown; onChange: (v: unknown) => void }) {
  const opts = filterOptions(type);
  switch (type) {
    case "colors":
    case "keywords":
      return <Toggles value={(value as string[]) ?? []} options={opts ?? []} onChange={onChange} />;
    case "cardType":
    case "skillKind":
      return <SelectChip label="value" value={(value as string) ?? ""} options={opts ?? []} optional={false} bad={value == null} onChange={(w) => onChange(w || null)} />;
    case "strings":
      return <StringsChip value={(value as string[]) ?? []} bad={!(value as string[])?.length} onChange={onChange} />;
    case "number":
      return <NumberChip label="value" value={value as number | null} bad={value == null} onChange={(n) => onChange(n ?? null)} />;
    case "boolean":
      return <SelectChip label="value" value={value ? "yes" : "no"} options={["yes", "no"]} optional={false} bad={false} onChange={(w) => onChange(w === "yes")} />;
    case "tri":
      return <SelectChip label="value" value={value == null ? "" : value ? "yes" : "no"} options={["yes", "no"]} optional bad={false} onChange={(w) => onChange(w === "" ? null : w === "yes")} />;
    case "powerRel": {
      const rel = (value as { of: string; cmp: string } | null) ?? { of: "self", cmp: "<=" };
      return (
        <span className="inline-flex flex-wrap gap-1">
          <SelectChip label="compared" value={rel.cmp} options={["<=", "<", ">=", ">"]} optional={false} bad={false} onChange={(cmp) => onChange({ ...rel, cmp })} />
          <SelectChip label="against" value={rel.of} options={["self", "chosen"]} labels={{ self: "this card's power", chosen: "the chosen card's power" }} optional={false} bad={false} onChange={(of) => onChange({ ...rel, of })} />
        </span>
      );
    }
  }
}

/** A number, or one of `EXPR_SCHEMA`'s readings of the board, as one chip whose choices run from 0 to "a count of…". */
function AmountChip({ value, path, bad, onChange, rule }: { value: unknown; path: RulePath; bad: boolean; onChange: (v: unknown) => void; rule: Rule }) {
  const shape = value === undefined ? "number" : amountShape(value);
  const v = (typeof value === "object" && value ? value : {}) as Loose;
  const bound = boundBefore(rule, path);
  const spec = exprSpec(shape);
  const shapes = EXPR_SPECS_SHAPES.map((s) => ({ value: `shape:${s.key}`, label: s.label }));
  if (shape === "number")
    return (
      <NumberChip
        label="amount"
        value={value as number | undefined}
        bad={bad}
        extra={shapes}
        onChange={(n) => {
          if (typeof n === "string" && String(n).startsWith("shape:")) onChange(blankAmount(String(n).slice(6), bound));
          else onChange(n);
        }}
      />
    );
  return (
    <>
      <Sel aria-label="what kind of number" value={shape} onChange={(e) => onChange(e.target.value === "number" ? 1 : blankAmount(e.target.value, bound))}>
        <option value="number">a number</option>
        {EXPR_SPECS_SHAPES.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </Sel>
      {shape === "var" && <SelectChip label="bound name" value={v.var as string} options={[...new Set([...bound, v.var as string])]} labels={Object.fromEntries([...bound, v.var as string].map((n) => [n, `$${n}`]))} optional={false} bad={false} onChange={(w) => onChange({ var: w })} />}
      {shape === "plus" && (
        <>
          <AmountChip value={(v.plus as unknown[])[0]} path={path} bad={false} onChange={(a) => onChange({ plus: [a, (v.plus as unknown[])[1]] })} rule={rule} />
          <span className={words}>+</span>
          <NumberChip label="plus" value={(v.plus as number[])[1]} bad={false} onChange={(n) => onChange({ plus: [(v.plus as unknown[])[0], n ?? 0] })} />
        </>
      )}
      {spec &&
        exprFields(spec).map((f, i) => {
          const arg = spec.args[i];
          const val = v[f];
          const put = (x: unknown) => onChange({ ...v, [f]: x });
          if (arg === "selector") return <SelectorPhrase key={f} value={val as Selector} path={path} bad={false} onChange={put} rule={rule} inCond />;
          if (arg === "number") return <NumberChip key={f} label={f} value={val as number} bad={false} onChange={(n) => put(n ?? 0)} />;
          if (arg === "side") return <SelectChip key={f} label="whose" value={val as string} options={optionsOf("side")} labels={SIDE_WORDS} optional={false} bad={false} onChange={put} />;
          if (arg === "attr") return <SelectChip key={f} label="which measure" value={val as string} options={EXPR_ATTRS} optional={false} bad={false} onChange={put} />;
          if (arg === "var") return <SelectChip key={f} label="bound name" value={(val as Loose)?.var as string} options={[...new Set([...bound, (val as Loose)?.var as string])]} optional={false} bad={false} onChange={(w) => put({ var: w })} />;
          return <RefChip key={f} value={val as Loose} path={path} optional={false} bad={false} onChange={put} rule={rule} />;
        })}
      {spec?.times && (
        <>
          <span className={words}>×</span>
          <NumberChip
            label="times"
            value={(v.times as number) ?? 1}
            bad={false}
            onChange={(n) => {
              const next = { ...v };
              if (n === undefined || n === 1) delete next.times;
              else next.times = n;
              onChange(next);
            }}
          />
        </>
      )}
    </>
  );
}
