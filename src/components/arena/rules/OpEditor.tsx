"use client";

import { useState } from "react";
import { parseFilter, type CardFilter } from "@/lib/arena/engine/filters";
import { AREAS, DURATIONS, KEYWORD_NAMES, OP_SCHEMA, SIDES, describeCond, describeFilter, describeScript, type FieldType, type Op, type OpField } from "@/lib/arena/engine/script";

/**
 * One step of a program as a chip, read-only or with a control per field.
 *
 * Every control comes from the field's type in `OP_SCHEMA`, so a new op is
 * editable the moment it has a row. Nested programs, conditions and modal
 * options are shown but edited through the JSON view (phase 1).
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
      return undefined;
    case "modes":
      return [
        { label: "A", ops: [] },
        { label: "B", ops: [] },
      ];
  }
}

export function StepChip({ op, index, editing, onChange, onRemove }: { op: Op; index: number; editing: boolean; onChange: (op: Op) => void; onRemove: () => void }) {
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
          <button type="button" onClick={onRemove} className="ml-1 text-space-500 hover:text-loss" title="remove this step">
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
      return <span className="rounded bg-space-950 px-1.5 py-0.5 text-space-300">{value ? describeCond(value as Parameters<typeof describeCond>[0]) : "—"} <i className="text-space-500">(edit in JSON)</i></span>;
    case "ops":
      return <span className="rounded bg-space-950 px-1.5 py-0.5 text-space-300">{Array.isArray(value) && value.length ? describeScript(value as Op[]) : "nothing"} <i className="text-space-500">(edit in JSON)</i></span>;
    case "modes":
      return (
        <span className="rounded bg-space-950 px-1.5 py-0.5 text-space-300">
          {((value as { ops: Op[] }[]) ?? []).map((m) => describeScript(m.ops) || "nothing").join(" / ")} <i className="text-space-500">(edit in JSON)</i>
        </span>
      );
  }
}

function AmountControl({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const mode = typeof value === "number" ? "n" : value && typeof value === "object" && "count" in (value as object) ? "each" : value && typeof value === "object" && "var" in (value as object) ? "var" : value && typeof value === "object" && "sumPower" in (value as object) ? "sum" : value && typeof value === "object" && "handUpTo" in (value as object) ? "hand" : "n";
  const v = value as Loose;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <select
        className={select}
        value={mode}
        onChange={(e) => {
          const m = e.target.value;
          onChange(m === "n" ? 1 : m === "each" ? { count: { side: "you", area: "battle", count: 99 }, times: 1 } : m === "var" ? { var: "t" } : m === "sum" ? { sumPower: { var: "t" } } : { handUpTo: 4 });
        }}
      >
        <option value="n">a number</option>
        <option value="each">for each…</option>
        <option value="var">that many</option>
        <option value="sum">total power of…</option>
        <option value="hand">hand up to</option>
      </select>
      {mode === "n" && <input type="number" className={`${input} w-20 text-right`} value={value as number} onChange={(e) => onChange(Number(e.target.value))} />}
      {mode === "each" && (
        <>
          <input type="number" className={`${input} w-20 text-right`} value={(v.times as number) ?? 1} onChange={(e) => onChange({ ...v, times: Number(e.target.value) })} title="times" />
          × <SelectorControl value={(v.count as Loose) ?? {}} onChange={(sel) => onChange({ ...v, count: sel })} />
        </>
      )}
      {(mode === "var" || mode === "sum") && <input className={`${input} w-16`} value={mode === "var" ? (v.var as string) : ((v.sumPower as Loose).var as string)} onChange={(e) => onChange(mode === "var" ? { var: e.target.value } : { sumPower: { var: e.target.value } })} title="the bound name" />}
      {mode === "hand" && <input type="number" className={`${input} w-16 text-right`} value={v.handUpTo as number} onChange={(e) => onChange({ handUpTo: Number(e.target.value) })} />}
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
