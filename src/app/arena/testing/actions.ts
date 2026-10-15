"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { importEvaluationRun, recordTestingMatch, updateTestingDeck, updateTestingScenario } from "@/lib/arena/testing/store";
import { MAX_MANIFEST_BYTES, parseEvaluationManifestJson } from "@/lib/arena/testing/run-manifest";
import type { ActorKind, MatchOutcome, ProgressStatus, RecordTestingMatchInput } from "@/lib/arena/testing/types";
import { requireSl } from "@/lib/auth";

export interface TestingActionState {
  error?: string;
  message?: string;
  formEpoch?: string;
}

export async function importEvaluationRunAction(_previous: TestingActionState | null, form: FormData): Promise<TestingActionState> {
  await requireSl();
  const file = form.get("manifest");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a versioned Arena run manifest JSON file." };
  if (file.size > MAX_MANIFEST_BYTES) return { error: "Manifest exceeds the 512 KiB import limit. Import the allowlisted manifest, not a replay or snapshot." };
  let raw: string;
  try { raw = await file.text(); }
  catch { return { error: "Could not read that manifest file." }; }
  const parsed = parseEvaluationManifestJson(raw);
  if (!parsed.ok) return { error: parsed.reason };
  try {
    const imported = await importEvaluationRun(db, parsed.value);
    if (!imported.ok) return { error: imported.reason === "invalid" ? imported.detail ?? "The manifest is invalid." : "This request ID was already imported with different content." };
    revalidatePath("/arena/testing");
    return { message: imported.replayed ? "This manifest was already imported; no duplicates were added." : "Versioned run evidence imported. Coverage progress was not changed.", formEpoch: `${imported.runId}:${Date.now()}` };
  } catch {
    return { error: "Could not save this run right now. Check run history before retrying." };
  }
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
  const evidenceRaw = form.get("evidence");
  if (typeof evidenceRaw === "string" && evidenceRaw.length > 2000) return { error: "Evidence must be 2,000 characters or fewer. Shorten it and try again." };
  const evidence = text(form, "evidence", 2000);
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
  const evidenceRaw = form.get("evidence");
  if (typeof evidenceRaw === "string" && evidenceRaw.length > 2000) return { error: "Evidence must be 2,000 characters or fewer. Shorten it and try again." };
  const evidence = text(form, "evidence", 2000);
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
  return { kind, name, model: kind === "human" ? null : model || null };
}

const recordError = (previous: TestingActionState | null, error: string): TestingActionState => ({ error, formEpoch: previous?.formEpoch ?? "0" });

export async function recordTestingMatchAction(previous: TestingActionState | null, form: FormData): Promise<TestingActionState> {
  await requireSl();
  const requestId = text(form, "requestId", 64);
  const p1 = actorFrom(form, "p1");
  const p2 = actorFrom(form, "p2");
  const p1DeckId = text(form, "p1DeckId", 160);
  const p2DeckId = text(form, "p2DeckId", 160);
  const outcome = text(form, "outcome", 24);
  const winnerRaw = text(form, "winner", 8);
  const seedRaw = text(form, "seed", 32);
  const costRaw = text(form, "reportedCostUsd", 32);
  const evidence = text(form, "evidence", 2000);
  if (!validRequestId(requestId)) return recordError(previous, "This form expired. Reload before recording the result again.");
  for (const seat of ["p1", "p2"] as const) {
    if (text(form, `${seat}Kind`, 24) === "opus" && !/opus[-._]\d/i.test(text(form, `${seat}Model`, 120))) {
      return recordError(previous, `Enter the exact versioned Opus model for ${seat === "p1" ? "Player 1" : "Player 2"} (for example, claude-opus-4-6).`);
    }
  }
  if (!p1 || !p2) return recordError(previous, "Enter a name and actor kind for both seats.");
  if (!p1DeckId || !p2DeckId) return recordError(previous, "Choose the recipe each seat used.");
  if (!validOutcome(outcome)) return recordError(previous, "Choose a valid result.");
  if (outcome === "win" ? winnerRaw !== "p1" && winnerRaw !== "p2" : winnerRaw !== "") return recordError(previous, "Select a winner only for a win; draws and unfinished games have no winner.");
  if ((outcome === "win" || outcome === "draw") && !evidence) return recordError(previous, "Add evidence for a completed result before recording it.");
  const seed = seedRaw ? Number(seedRaw) : null;
  if (seed != null && !Number.isSafeInteger(seed)) return recordError(previous, "Seed must be a whole number.");
  let reportedCostMicros: number | null = null;
  if (costRaw) {
    const usd = Number(costRaw);
    if (!Number.isFinite(usd) || usd < 0 || usd > 2147.483647) return recordError(previous, "Enter a reported USD amount from $0 to $2,147.483647.");
    reportedCostMicros = Math.round(usd * 1_000_000);
  }
  const input: RecordTestingMatchInput = {
    requestId, p1DeckId, p2DeckId, p1, p2, outcome,
    winner: outcome === "win" ? winnerRaw as "p1" | "p2" : null,
    seed, rulesRevision: text(form, "rulesRevision", 160), evidence, note: text(form, "note"), reportedCostMicros,
  };
  let result: Awaited<ReturnType<typeof recordTestingMatch>>;
  try { result = await recordTestingMatch(db, input); }
  catch { return recordError(previous, "Could not record this result right now. Check the recent results before retrying."); }
  if (!result.ok) return recordError(previous, "This request ID was already used for different match details. Reload the form and check the recent results before retrying.");
  revalidatePath("/arena/testing");
  return { message: result.replayed ? "This result was already recorded; no duplicate was added." : "Manual test result recorded.", formEpoch: `${previous?.formEpoch ?? "0"}:${requestId}` };
}
