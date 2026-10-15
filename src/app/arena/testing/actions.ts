"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { recordTestingMatch, updateTestingDeck, updateTestingScenario } from "@/lib/arena/testing/store";
import type { ActorKind, MatchOutcome, ProgressStatus, RecordTestingMatchInput } from "@/lib/arena/testing/types";
import { requireSl } from "@/lib/auth";

export interface TestingActionState {
  error?: string;
  message?: string;
}

const text = (form: FormData, key: string, max = 4000) => String(form.get(key) ?? "").trim().slice(0, max);
const int = (value: string) => /^\d+$/.test(value) ? Number(value) : NaN;
const PROGRESS_STATUSES: readonly ProgressStatus[] = ["planned", "in_progress", "blocked", "failed", "passed"];
const ACTOR_KINDS: readonly ActorKind[] = ["human", "local_ai", "opus", "other_ai"];
const MATCH_OUTCOMES: readonly MatchOutcome[] = ["win", "draw", "interrupted", "abandoned", "limit"];

export async function saveTestingDeckAction(_previous: TestingActionState | null, form: FormData): Promise<TestingActionState> {
  await requireSl();
  const id = text(form, "id", 160);
  const expectedVersion = int(text(form, "version", 20));
  const status = text(form, "status", 24) as ProgressStatus;
  const note = text(form, "note");
  const evidence = text(form, "evidence");
  const linkedDeckIdRaw = text(form, "linkedDeckId", 20);
  const linkedDeckId = linkedDeckIdRaw ? int(linkedDeckIdRaw) : null;
  if (!id || !Number.isSafeInteger(expectedVersion) || !PROGRESS_STATUSES.includes(status)) return { error: "This recipe form is invalid. Reload the page and try again." };
  if (linkedDeckIdRaw && !Number.isSafeInteger(linkedDeckId)) return { error: "Choose an actual deck from the list." };
  if (status === "passed" && !evidence) return { error: "Add the exact test or replay evidence before marking this recipe passed." };
  let result: Awaited<ReturnType<typeof updateTestingDeck>>;
  try { result = await updateTestingDeck(db, { id, expectedVersion, status, note, evidence, linkedDeckId }); }
  catch { return { error: "Could not save this recipe right now. Your notes remain in the form; try again." }; }
  if (!result.ok) return { error: result.reason === "conflict" ? "This recipe changed in another session. Your form is still here; reload to see the latest saved version." : "That recipe no longer exists. Reload the page." };
  revalidatePath("/arena/testing");
  return { message: "Recipe progress saved." };
}

export async function saveTestingScenarioAction(_previous: TestingActionState | null, form: FormData): Promise<TestingActionState> {
  await requireSl();
  const id = text(form, "id", 160);
  const expectedVersion = int(text(form, "version", 20));
  const status = text(form, "status", 24) as ProgressStatus;
  const note = text(form, "note");
  const evidence = text(form, "evidence");
  if (!id || !Number.isSafeInteger(expectedVersion) || !PROGRESS_STATUSES.includes(status)) return { error: "This scenario form is invalid. Reload the page and try again." };
  if (status === "passed" && !evidence) return { error: "Add the exact test or replay evidence before marking this scenario passed." };
  let result: Awaited<ReturnType<typeof updateTestingScenario>>;
  try { result = await updateTestingScenario(db, { id, expectedVersion, status, note, evidence }); }
  catch { return { error: "Could not save this scenario right now. Your notes remain in the form; try again." }; }
  if (!result.ok) return { error: result.reason === "conflict" ? "This scenario changed in another session. Your form is still here; reload to see the latest saved version." : "That scenario no longer exists. Reload the page." };
  revalidatePath("/arena/testing");
  return { message: "Scenario progress saved." };
}

const validActor = (kind: string): kind is ActorKind => (ACTOR_KINDS as readonly string[]).includes(kind);
const validOutcome = (outcome: string): outcome is MatchOutcome => (MATCH_OUTCOMES as readonly string[]).includes(outcome);
const validRequestId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

function actorFrom(form: FormData, seat: "p1" | "p2"): RecordTestingMatchInput[typeof seat] | null {
  const kind = text(form, `${seat}Kind`, 24);
  const name = text(form, `${seat}Name`, 120);
  const model = text(form, `${seat}Model`, 120);
  if (!validActor(kind) || !name) return null;
  return { kind, name, model: model || null };
}

export async function recordTestingMatchAction(_previous: TestingActionState | null, form: FormData): Promise<TestingActionState> {
  await requireSl();
  const requestId = text(form, "requestId", 64);
  const p1 = actorFrom(form, "p1");
  const p2 = actorFrom(form, "p2");
  const p1DeckId = text(form, "p1DeckId", 20);
  const p2DeckId = text(form, "p2DeckId", 20);
  const outcome = text(form, "outcome", 24);
  const winnerRaw = text(form, "winner", 8);
  const seedRaw = text(form, "seed", 32);
  const costRaw = text(form, "reportedCostUsd", 32);
  const evidence = text(form, "evidence", 2000);
  if (!validRequestId(requestId)) return { error: "This form expired. Reload before recording the result again." };
  if (!p1 || !p2) return { error: "Enter a name and actor kind for both seats." };
  if (!p1DeckId || !p2DeckId) return { error: "Choose the actual deck each seat used." };
  if (!validOutcome(outcome)) return { error: "Choose a valid result." };
  if (outcome === "win" ? winnerRaw !== "p1" && winnerRaw !== "p2" : winnerRaw !== "") return { error: "Select a winner only for a win; draws and unfinished games have no winner." };
  if ((outcome === "win" || outcome === "draw") && !evidence) return { error: "Add evidence for a completed result before recording it." };
  const seed = seedRaw ? Number(seedRaw) : null;
  if (seed != null && !Number.isSafeInteger(seed)) return { error: "Seed must be a whole number." };
  let reportedCostMicros: number | null = null;
  if (costRaw) {
    const usd = Number(costRaw);
    if (!Number.isFinite(usd) || usd < 0 || usd > 2147.483647) return { error: "Enter a reported USD amount from $0 to $2,147.483647." };
    reportedCostMicros = Math.round(usd * 1_000_000);
  }
  const input: RecordTestingMatchInput = {
    requestId, p1DeckId, p2DeckId, p1, p2, outcome,
    winner: outcome === "win" ? winnerRaw as "p1" | "p2" : null,
    seed, rulesRevision: text(form, "rulesRevision", 160), evidence, note: text(form, "note"), reportedCostMicros,
  };
  let result: Awaited<ReturnType<typeof recordTestingMatch>>;
  try { result = await recordTestingMatch(db, input); }
  catch { return { error: "Could not record this result right now. Check the recent results before retrying." }; }
  if (!result.ok) return { error: "This request ID was already used for different match details. Reload the form and check the recent results before retrying." };
  revalidatePath("/arena/testing");
  return { message: result.replayed ? "This result was already recorded; no duplicate was added." : "Manual test result recorded." };
}
