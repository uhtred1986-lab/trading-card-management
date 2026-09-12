"use client";

import { useState } from "react";
import { EXPR_ATTRS } from "@/lib/arena/lang";
import { parseFilter, type CardFilter } from "@/lib/arena/engine/filters";
import { AREAS, COND_SCHEMA, DURATIONS, KEYWORD_NAMES, OP_SCHEMA, SIDES, describeCond, describeFilter, describeScript, type Cond, type FieldType, type Op, type OpField } from "@/lib/arena/engine/script";

/**
 * One step of a program as a chip, read-only or with a control per field.
 *
 * Every control comes from the field's type in `OP_SCHEMA` — and every
 * condition from its row in `COND_SCHEMA` — so a new op or a new condition
 * kind is editable the moment it has a row. Nested programs, modal options
 * and conditions are edited here too; the JSON view is a second way to see
 * the same program, not the only way to change part of it.
 */

type Loose = Record<string, unknown>;
const SPECIALS = ["self", "attacker", "guard", "subject", "leader", "opponentLeader", "resolving"] as const;
const SPECIAL_LABEL: Record<(typeof SPECIALS)[number], string> = {
  self: "this card",
  attacker: "the attacking card",
  guard: "the guard card",
  subject: "that card",
  leader: "your leader",
  opponentLeader: "the opposing leader",
  resolving: "the card being played",
};

const select = "rounded border border-space-600 bg-space-950 px-1 py-0.5 text-[11px] font-semibold text-ki-300";
const input = "rounded border border-space-600 bg-space-950 px-1 py-0.5 text-[11px] text-space-100";

/** A minimal op of this kind: every required field filled with the plainest value of its type. */
export function blankOp(name: Op["op"]): Op {
  const op: Loose = { op: name };
  for (const f of OP_SCHEMA[name].fields) if (f.required) op[f.name] = blankValue(f);
  return op as unknown as Op;
}

function blankValue(f: OpField): unknown {
  const t = f.type;
  if (typeof t === "object") return "enum" in t ? t.enum[0] : [];
  switch (t) {
    case "amount":
      return 1;
    case "ref":
      return { var: "t" };
    case "selector":
      return { side: "opponent", area: "battle", count: 1 };
    case "side":
      return "you";
    case "area":
      return "drop";
    case "duration":
      return "turn";
    case "cond":
      return { kind: "isTurnPlayer" };
    case "conds":
      return [{ kind: "isTurnPlayer" }];
    case "ops":
      return [];
    case "string":
      return f.name === "as" ? "t" : "";
    case "number":
      return f.nullable ? null : 0;
    case "boolean":
      return true;
    case "keyword":
      return { name: "Blocker" };
    case "filter":
      // A filter the schema requires has to be a whole one: "card" is the
      // filter that matches anything, and `matches` reads every field.
      return f.required ? parseFilter("card") : undefined;
    case "modes":
      return [
        { label: "A", ops: [] },
        { label: "B", ops: [] },
      ];
  }
}

/** A minimal condition of this kind: every required field filled from its type. */
export function blankCond(kind: Cond["kind"]): Cond {
  const cond: Loose = { kind };
  for (const f of COND_SCHEMA[kind].fields) if (f.required) cond[f.name] = blankValue(f);
  return cond as unknown as Cond;
}

/**
 * A program as an ordered list of chips: the DO row, and every nested program
 * inside one. Order is part of the meaning — "choose, then KO it" is not "KO
 * it, then choose" — so it is edited here rather than only in the JSON.
 */
export function OpList({ ops, editing, onChange, nested = false }: { ops: Op[]; editing: boolean; onChange: (ops: Op[]) => void; nested?: boolean }) {
  const move = (i: number, by: number) => {
    const to = i + by;
    if (to < 0 || to >= ops.length) return;
    const next = [...ops];
    [next[i], next[to]] = [next[to], next[i]];
    onChange(next);
  };
  return (
    <div className={`flex w-full flex-col gap-1.5 ${nested ? "rounded-lg border border-dashed border-space-600 p-1.5" : ""}`}>
      {ops.length === 0 && !editing && <div className={nested ? "text-[11px] text-space-500" : "rounded-lg border border-loss/50 px-2 py-1.5 text-[12px] text-loss"}>{nested ? "nothing" : "nothing — the engine treats this skill as blank"}</div>}
      {ops.map((op, i) => (
        <StepChip key={i} op={op} index={i} editing={editing} first={i === 0} last={i === ops.length - 1} onChange={(o) => onChange(ops.map((x, j) => (j === i ? o : x)))} onMove={(by) => move(i, by)} onRemove={() => onChange(ops.filter((_, j) => j !== i))} />
      ))}
      {editing && (
        <span>
          <select className="tap rounded-lg border border-dashed border-space-600 bg-transparent px-2 py-1 text-xs text-space-300" value="" onChange={(e) => e.target.value && onChange([...ops, blankOp(e.target.value as Op["op"])])}>
            <option value="">+ step</option>
            {(Object.keys(OP_SCHEMA) as Op["op"][]).map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </span>
      )}
    </div>
  );
}

/** One condition, from its row: the kind, then a control per field. */
export function CondChip({ cond, editing, onChange, onRemove }: { cond: Cond; editing: boolean; onChange: (c: Cond) => void; onRemove?: () => void }) {
  const spec = COND_SCHEMA[cond.kind];
  const loose = cond as unknown as Loose;
  const set = (name: string, v: unknown) => {
    const next: Loose = { ...loose };
    if (v === undefined) delete next[name];
    else next[name] = v;
    onChange(next as unknown as Cond);
  };
  if (!editing) return <span className="rounded bg-space-950 px-1.5 py-0.5 text-space-300">{describeCondSafely(cond)}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 rounded border border-dashed border-space-600 px-1 py-0.5">
      <select className={select} value={cond.kind} onChange={(e) => onChange(blankCond(e.target.value as Cond["kind"]))} title="which condition">
        {(Object.keys(COND_SCHEMA) as Cond["kind"][]).map((k) => (
          <option key={k}>{k}</option>
        ))}
      </select>
      {spec.fields.map((f) => (
        <label key={f.name} className="inline-flex items-center gap-1 text-[10px] text-space-400">
          {f.name}
          <FieldControl field={f} value={loose[f.name]} onChange={(v) => set(f.name, v)} />
        </label>
      ))}
      {onRemove && (
        <button type="button" onClick={onRemove} className="ml-0.5 text-space-500 hover:text-loss" title="remove this condition">
          ×
        </button>
      )}
    </span>
  );
}

/** A half-built condition is a normal state while editing; its sentence is not. */
function describeCondSafely(cond: Cond): string {
  try {
    return describeCond(cond);
  } catch {
    return `${cond.kind} — not filled in yet`;
  }
}

export function StepChip({ op, index, editing, first, last, onChange, onMove, onRemove }: { op: Op; index: number; editing: boolean; first: boolean; last: boolean; onChange: (op: Op) => void; onMove: (by: number) => void; onRemove: () => void }) {
  const spec = OP_SCHEMA[op.op];
  const loose = op as unknown as Loose;
  const set = (name: string, v: unknown) => {
    const next: Loose = { ...loose };
    if (v === undefined) delete next[name];
    else next[name] = v;
    onChange(next as unknown as Op);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-space-600 bg-space-800 px-2 py-1.5 text-[12px] text-space-100">
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-space-950 text-[10px] font-bold text-space-400">{index + 1}</span>
      {!editing ? (
        <span>{describeScript([op], { permanent: false }) || <span className="text-space-400">{op.op}</span>}</span>
      ) : (
        <>
          <select className={select} value={op.op} onChange={(e) => onChange(blankOp(e.target.value as Op["op"]))} title="which step">
            {(Object.keys(OP_SCHEMA) as Op["op"][]).map((k) => (
                <option key={k}>{k}</option>
              ))}
          </select>
          {spec.fields.map((f) => (
            <label key={f.name} className="inline-flex items-center gap-1 text-[10px] text-space-400">
              {f.name}
              <FieldControl field={f} value={loose[f.name]} onChange={(v) => set(f.name, v)} />
            </label>
          ))}
          <button type="button" disabled={first} onClick={() => onMove(-1)} className="ml-1 text-space-500 hover:text-ki-300 disabled:opacity-25" title="one step earlier">
            ↑
          </button>
          <button type="button" disabled={last} onClick={() => onMove(1)} className="text-space-500 hover:text-ki-300 disabled:opacity-25" title="one step later">
            ↓
          </button>
          <button type="button" onClick={onRemove} className="text-space-500 hover:text-loss" title="remove this step">
            ×
          </button>
        </>
      )}
    </div>
  );
}

function FieldControl({ field, value, onChange }: { field: OpField; value: unknown; onChange: (v: unknown) => void }) {
  const t: FieldType = field.type;
  const optional = !field.required;
  const unset = <option value="">—</option>;
  if (typeof t === "object") {
    if ("enum" in t)
      return (
        <select className={select} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
          {optional && unset}
          {t.enum.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      );
    return <input className={input} placeholder="a, b" value={Array.isArray(value) ? value.join(", ") : ""} onChange={(e) => onChange(e.target.value.trim() ? e.target.value.split(/\s*,\s*/) : optional ? undefined : [])} />;
  }
  switch (t) {
    case "side":
    case "area":
    case "duration": {
      const options = t === "side" ? SIDES : t === "area" ? AREAS : DURATIONS;
      return (
        <select className={select} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
          {optional && unset}
          {options.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      );
    }
    case "boolean":
      return (
        <select className={select} value={value === undefined ? "" : value ? "yes" : "no"} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "yes")}>
          {optional && unset}
          <option value="yes">yes</option>
          <option value="no">no</option>
        </select>
      );
    case "number":
      return <input type="number" className={`${input} w-20 text-right`} value={value == null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? (field.nullable ? null : optional ? undefined : 0) : Number(e.target.value))} />;
    case "string":
      return <input className={`${input} w-24`} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || (optional ? undefined : ""))} />;
    case "keyword":
      return (
        <select className={select} value={(value as { name?: string })?.name ?? "Blocker"} onChange={(e) => onChange({ name: e.target.value })}>
          {KEYWORD_NAMES.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      );
    case "amount":
      return <AmountControl value={value} onChange={onChange} />;
    case "ref":
      return <RefControl value={value as Loose | undefined} optional={optional} onChange={onChange} />;
    case "selector":
      return <SelectorControl value={(value as Loose) ?? {}} onChange={onChange} />;
    case "filter":
      return <FilterControl value={value as CardFilter | undefined} onChange={onChange} />;
    case "cond":
      return <CondChip cond={(value as Cond) ?? blankCond("isTurnPlayer")} editing onChange={onChange} onRemove={optional ? () => onChange(undefined) : undefined} />;
    case "conds":
      return <CondListControl value={(value as Cond[]) ?? []} onChange={onChange} />;
    case "ops":
      return <OpList ops={(value as Op[]) ?? []} editing onChange={onChange} nested />;
    case "modes":
      return <ModesControl value={(value as { label: string; ops: Op[] }[]) ?? []} onChange={onChange} />;
  }
}

/** "One of these": the conditions `any` and `all` join. */
function CondListControl({ value, onChange }: { value: Cond[]; onChange: (v: unknown) => void }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {value.map((c, i) => (
        <CondChip key={i} cond={c} editing onChange={(next) => onChange(value.map((x, j) => (j === i ? next : x)))} onRemove={() => onChange(value.filter((_, j) => j !== i))} />
      ))}
      <button type="button" className="tap rounded border border-dashed border-space-600 px-1.5 py-0.5 text-[10px] text-space-300" onClick={() => onChange([...value, blankCond("isTurnPlayer")])}>
        + condition
      </button>
    </span>
  );
}

/** The printed options of a "Choose one—": a label the player reads, and what it does. */
function ModesControl({ value, onChange }: { value: { label: string; ops: Op[] }[]; onChange: (v: unknown) => void }) {
  const set = (i: number, mode: { label: string; ops: Op[] }) => onChange(value.map((m, j) => (j === i ? mode : m)));
  return (
    <span className="inline-flex w-full flex-col gap-1">
      {value.map((m, i) => (
        <span key={i} className="inline-flex flex-wrap items-start gap-1 rounded border border-dashed border-space-600 p-1">
          <input className={`${input} w-40`} value={m.label} placeholder="what the option says" onChange={(e) => set(i, { ...m, label: e.target.value })} />
          <OpList ops={m.ops} editing onChange={(ops) => set(i, { ...m, ops })} nested />
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-space-500 hover:text-loss" title="remove this option">
            ×
          </button>
        </span>
      ))}
      <button type="button" className="tap self-start rounded border border-dashed border-space-600 px-1.5 py-0.5 text-[10px] text-space-300" onClick={() => onChange([...value, { label: "", ops: [] }])}>
        + option
      </button>
    </span>
  );
}

/**
 * An expression, as chips (20-5). The mode list is the `Amount` union: the two
 * literals, the one operator, and one entry per `EXPR_SCHEMA` row.
 *
 * Every shape needs a control of its own, not because each is often edited but
 * because a shape this control cannot *show* is one it silently replaces the
 * moment anything else on the chip is touched — and the record would be
 * quietly narrowed with no way to see it happen.
 */
type AmountMode = "n" | "var" | "plus" | "each" | "markers" | "sum" | "hand" | "x" | "life" | "attr" | "sumOf";

const AMOUNT_LABELS: Record<AmountMode, string> = {
  n: "a number",
  var: "that many",
  plus: "… and N more",
  each: "for each…",
  markers: "for each marker on…",
  sum: "total power of…",
  hand: "hand up to",
  x: "X (the price paid)",
  life: "for each life…",
  attr: "one card's…",
  sumOf: "the total … of…",
};

const AMOUNT_BLANKS: Record<AmountMode, unknown> = {
  n: 1,
  var: { var: "t" },
  plus: { plus: [1, 1] },
  each: { count: { side: "you", area: "battle", count: 99 }, times: 1 },
  markers: { markers: { special: "self" }, times: 1 },
  sum: { sumPower: { var: "t" } },
  hand: { handUpTo: 4 },
  x: { x: true },
  life: { life: "you" },
  attr: { attr: { var: "t" }, name: "power" },
  sumOf: { sumOf: { side: "you", area: "drop", count: 99 }, attr: "comboPower" },
};

function amountMode(value: unknown): AmountMode {
  if (typeof value === "number" || !value || typeof value !== "object") return "n";
  const bag = value as Record<string, unknown>;
  if ("plus" in bag) return "plus";
  if ("var" in bag) return "var";
  if ("count" in bag) return "each";
  if ("markers" in bag) return "markers";
  if ("sumPower" in bag) return "sum";
  if ("handUpTo" in bag) return "hand";
  if ("x" in bag) return "x";
  if ("life" in bag) return "life";
  // `sumOf` before `attr`: the two share an `attr` key.
  if ("sumOf" in bag) return "sumOf";
  if ("attr" in bag) return "attr";
  return "n";
}

/** The `* n` every board-reading shape may carry. Absent is once, not none. */
function TimesControl({ v, onChange }: { v: Loose; onChange: (x: unknown) => void }) {
  return (
    <input
      type="number"
      className={`${input} w-20 text-right`}
      value={(v.times as number) ?? 1}
      onChange={(e) => {
        const n = Number(e.target.value);
        const next = { ...v };
        if (n === 1) delete next.times;
        else next.times = n;
        onChange(next);
      }}
      title="times"
    />
  );
}

function AmountControl({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const mode = amountMode(value);
  const v = (typeof value === "object" && value ? value : {}) as Loose;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <select className={select} value={mode} onChange={(e) => onChange(AMOUNT_BLANKS[e.target.value as AmountMode])}>
        {(Object.keys(AMOUNT_LABELS) as AmountMode[]).map((m) => (
          <option key={m} value={m}>
            {AMOUNT_LABELS[m]}
          </option>
        ))}
      </select>
      {mode === "n" && <input type="number" className={`${input} w-20 text-right`} value={value as number} onChange={(e) => onChange(Number(e.target.value))} />}
      {mode === "each" && (
        <>
          <TimesControl v={v} onChange={onChange} /> × <SelectorControl value={(v.count as Loose) ?? {}} onChange={(sel) => onChange({ ...v, count: sel })} />
        </>
      )}
      {mode === "markers" && (
        <>
          <TimesControl v={v} onChange={onChange} /> × marker on <SelectorControl value={(v.markers as Loose) ?? {}} onChange={(sel) => onChange({ ...v, markers: sel })} />
        </>
      )}
      {(mode === "var" || mode === "sum") && (
        <input
          className={`${input} w-16`}
          value={mode === "var" ? (v.var as string) : (((v.sumPower as Loose)?.var as string) ?? "t")}
          onChange={(e) => onChange(mode === "var" ? { var: e.target.value } : { sumPower: { var: e.target.value } })}
          title="the bound name"
        />
      )}
      {mode === "hand" && <input type="number" className={`${input} w-16 text-right`} value={v.handUpTo as number} onChange={(e) => onChange({ handUpTo: Number(e.target.value) })} />}
      {mode === "x" && (
        <>
          <TimesControl v={v} onChange={onChange} /> × X
        </>
      )}
      {mode === "life" && (
        <>
          <TimesControl v={v} onChange={onChange} /> ×
          <select className={select} value={(v.life as string) ?? "you"} onChange={(e) => onChange({ ...v, life: e.target.value })}>
            {SIDES.map((side) => (
              <option key={side}>{side}</option>
            ))}
          </select>
        </>
      )}
      {mode === "attr" && (
        <>
          <TimesControl v={v} onChange={onChange} /> ×
          <select className={select} value={(v.name as string) ?? "power"} onChange={(e) => onChange({ ...v, name: e.target.value })}>
            {EXPR_ATTRS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          of <RefControl value={v.attr as Loose | undefined} optional={false} onChange={(ref) => onChange({ ...v, attr: ref })} />
        </>
      )}
      {mode === "sumOf" && (
        <>
          <TimesControl v={v} onChange={onChange} /> ×
          <select className={select} value={(v.attr as string) ?? "power"} onChange={(e) => onChange({ ...v, attr: e.target.value })}>
            {EXPR_ATTRS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          of every <SelectorControl value={(v.sumOf as Loose) ?? {}} onChange={(sel) => onChange({ ...v, sumOf: sel })} />
        </>
      )}
      {mode === "plus" && (
        <>
          <AmountControl value={(v.plus as unknown[])?.[0] ?? 1} onChange={(inner) => onChange({ plus: [inner, (v.plus as unknown[])?.[1] ?? 1] })} />
          +
          <input
            type="number"
            className={`${input} w-20 text-right`}
            value={((v.plus as unknown[])?.[1] as number) ?? 1}
            onChange={(e) => onChange({ plus: [(v.plus as unknown[])?.[0] ?? 1, Number(e.target.value)] })}
          />
        </>
      )}
    </span>
  );
}

function RefControl({ value, optional, onChange }: { value: Loose | undefined; optional: boolean; onChange: (v: unknown) => void }) {
  const kind = !value ? "" : "var" in value ? "var" : (value.sel as Loose)?.special ? `special:${(value.sel as Loose).special}` : "sel";
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <select
        className={select}
        value={kind}
        onChange={(e) => {
          const k = e.target.value;
          onChange(k === "" ? undefined : k === "var" ? { var: "t" } : k === "sel" ? { sel: { side: "opponent", area: "battle", count: 1 } } : { sel: { special: k.slice("special:".length) } });
        }}
      >
        {optional && <option value="">—</option>}
        <option value="var">the chosen cards</option>
        {SPECIALS.map((s) => (
          <option key={s} value={`special:${s}`}>
            {SPECIAL_LABEL[s]}
          </option>
        ))}
        <option value="sel">cards matching…</option>
      </select>
      {kind === "var" && <input className={`${input} w-14`} value={value!.var as string} onChange={(e) => onChange({ ...value, var: e.target.value })} title="the bound name" />}
      {kind === "sel" && <SelectorControl value={value!.sel as Loose} onChange={(sel) => onChange({ sel })} />}
    </span>
  );
}

function SelectorControl({ value, onChange }: { value: Loose; onChange: (v: unknown) => void }) {
  const set = (k: string, v: unknown) => {
    const next = { ...value };
    if (v === undefined || v === "" || v === false) delete next[k];
    else next[k] = v;
    onChange(next);
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1 rounded border border-dashed border-space-600 px-1 py-0.5">
      <select className={select} value={(value.side as string) ?? ""} onChange={(e) => set("side", e.target.value)} title="whose">
        <option value="">—</option>
        {SIDES.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <select className={select} value={(value.area as string) ?? ""} onChange={(e) => set("area", e.target.value)} title="where">
        <option value="">—</option>
        {AREAS.map((a) => (
          <option key={a}>{a}</option>
        ))}
      </select>
      <input type="number" className={`${input} w-14 text-right`} value={(value.count as number) ?? ""} placeholder="n" onChange={(e) => set("count", e.target.value === "" ? undefined : Number(e.target.value))} title="how many (99 = all)" />
      <label className="inline-flex items-center gap-0.5 text-[10px] text-space-400">
        <input type="checkbox" checked={!!value.upTo} onChange={(e) => set("upTo", e.target.checked)} /> up to
      </label>
      <select className={select} value={(value.mode as string) ?? ""} onChange={(e) => set("mode", e.target.value)} title="in which mode">
        <option value="">any mode</option>
        <option value="active">active</option>
        <option value="rest">rest</option>
      </select>
      <FilterControl value={value.filter as CardFilter | undefined} onChange={(f) => set("filter", f)} />
    </span>
  );
}

/** A filter is typed as the cards print it — "red ≪Saiyan≫ card with an energy cost of 3 or less" — and read by the compiler's own parser on blur. */
function FilterControl({ value, onChange }: { value: CardFilter | undefined; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(value ? describeFilter(value) : "");
  return <input className={`${input} w-40`} value={text} placeholder="filter, as the card says it" onChange={(e) => setText(e.target.value)} onBlur={() => onChange(text.trim() ? parseFilter(text) : undefined)} title="which cards" />;
}
