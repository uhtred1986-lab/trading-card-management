import Link from "next/link";
import { requireSignedInPage } from "@/lib/auth";
import { PageHeader, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TutorialPhonePage() {
  await requireSignedInPage();

  return (
    <section className="ds-page flex min-w-0 flex-col items-center gap-4">
      <PageHeader title="Tutorial phone preview" eyebrow="Arena · Learn" description="390 × 844 px viewport. On smaller screens, the preview fits the available width." actions={<Link href="/arena/tutorial" className="ds-button-secondary">Open tutorial directly</Link>} />
      <Panel className="w-full max-w-[390px] p-0">
      <iframe
        src="/arena/tutorial"
        title="Arena tutorial — 390 × 844 phone preview"
        width={390}
        height={844}
        className="block shrink-0 bg-space-950 outline outline-1 outline-space-700"
        style={{ width: 390, maxWidth: "100%", height: 844, border: 0 }}
      />
      </Panel>
    </section>
  );
}
