import { notFound } from "next/navigation";
import { SandboxPlay } from "@/components/arena/rules/tryit/SandboxPlay";
import { PageHeader } from "@/components/ui";
import { requireSlPage } from "@/lib/auth";
import { FIXTURE_SOURCE, FIXTURES, ruleFromSource } from "@/lib/arena/sandbox/fixture";

export const dynamic = "force-dynamic";

/**
 * Dev-only: the play-test sandbox on a synthetic card, with no database
 * behind it, so it can be opened and shot in a session that keeps off Neon
 * (the way `/arena/rules/card/preview` shows the card page). Production
 * answers 404. `?card=draw` (an [Auto] on attack) or `ko` (an [Activate:
 * Main]); `?board=<key>` picks a board. The "pretend edit" buttons stand in
 * for the builder's unsaved rule.
 */
const EDITS: Record<string, { label: string; source: string }[]> = {
  draw: [
    { label: "Edit: draw 3", source: FIXTURE_SOURCE.draw.replace("n: 1", "n: 3") },
    { label: "Edit: also draw on defence", source: FIXTURE_SOURCE.draw.replace("attacks", "attacked") },
  ],
  ko: [{ label: "Edit: costs 20", source: FIXTURE_SOURCE.ko.replace("THEN", `COST ${"{any}".repeat(20)}\nTHEN`) }],
};

export default async function PlayPreviewPage({ searchParams }: { searchParams: Promise<{ card?: string; board?: string }> }) {
  await requireSlPage();
  if (process.env.NODE_ENV === "production") notFound();
  const q = await searchParams;
  const fixture = FIXTURES.includes(q.card ?? "") ? (q.card as string) : "draw";
  return (
    <div className="space-y-3">
      <PageHeader title="Play-test" eyebrow="Development preview" description={`Synthetic fixture: ${fixture}. Nothing is saved and no database is read.`} />
      <SandboxPlay ruleId={null} fixture={fixture} boardKey={q.board ?? null} backHref="/arena/rules/card/preview" edits={(EDITS[fixture] ?? []).map((e) => ({ label: e.label, rule: ruleFromSource(e.source) }))} />
    </div>
  );
}
