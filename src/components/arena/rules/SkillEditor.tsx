"use client";

import { useState, useSyncExternalStore } from "react";
import type { SkillView } from "@/app/arena/rules/card/types";
import type { Rule } from "@/lib/arena/lang";
import type { RulePath } from "@/lib/arena/lang/path";
import { playHref } from "@/lib/arena/rule-card";
import { draftKey } from "@/lib/arena/sandbox/draft";
import { FullRuleBuilder } from "./FullRuleBuilder";
import { RuleBuilder } from "./RuleBuilder";

const noop = () => () => {};

/** The unsaved rule the sandbox (or an earlier visit) left for this rule, when it is a real rule. */
function leftDraft(ruleId: number): Rule | null {
  try {
    const raw = sessionStorage.getItem(draftKey(ruleId));
    const v = raw ? (JSON.parse(raw) as Partial<Rule>) : null;
    return v && typeof v === "object" && typeof v.kind === "string" && Array.isArray(v.ops) && Array.isArray(v.trigger) ? (v as Rule) : null;
  } catch {
    return null;
  }
}

function dropDraft(ruleId: number) {
  try {
    sessionStorage.removeItem(draftKey(ruleId));
  } catch {
    /* nothing to drop */
  }
}

/**
 * One skill's editor on the Card rules page: the block builder with its text
 * view, Try it and teach tabs (`FullRuleBuilder`), opened in a side column on a
 * computer and a full-screen sheet on a phone (the caller decides where it sits).
 *
 * The rule the sandbox kept for this skill (Play-test this edit ▶) comes back
 * when the editor opens again, so edit → play → edit does not lose the edit; it
 * is dropped on Discard and on Save. `fixture` is the development preview's
 * builder: no server calls behind it.
 */
export function SkillEditor({ skill, cardId, cardName, canSave, fixture = false, onClose, onSaved }: { skill: SkillView; cardId: string; cardName: string; canSave: boolean; fixture?: boolean; onClose: () => void; onSaved: () => void }) {
  const browser = useSyncExternalStore(noop, () => true, () => false);
  const ruleId = skill.ruleId ?? 0;
  // Read once when the editor opens: a later write to storage (the sandbox's) must not swap the rule under the cursor.
  const [kept] = useState(() => (typeof window === "undefined" || fixture ? null : leftDraft(ruleId)));
  if (!skill.rule) return null;
  if (!browser) return <p className="p-4 text-sm text-space-400">Opening the editor…</p>;

  const props = {
    ruleId,
    initialRule: kept ?? skill.rule,
    focusPath: (skill.focus ?? undefined) as RulePath | undefined,
    card: { cardId, name: cardName, printed: skill.printed, unread: skill.status === "open" ? skill.unread : [] },
    canSave,
    onDiscard: () => {
      dropDraft(ruleId);
      onClose();
    },
    onSaved: () => {
      dropDraft(ruleId);
      onSaved();
    },
    ...(fixture ? {} : { playHref: playHref(cardId, ruleId) }),
  };
  return (
    <div className="min-w-0">
      {kept && <p className="mb-2 rounded-lg bg-space-800 px-3 py-2 text-xs text-space-200">Your unsaved edit from the play-test is back. Discard drops it.</p>}
      {fixture ? <RuleBuilder {...props} /> : <FullRuleBuilder key={ruleId} {...props} />}
    </div>
  );
}
