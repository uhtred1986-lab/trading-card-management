import Link from "next/link";
import { requireSignedInPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function TutorialPhonePage() {
  await requireSignedInPage();

  return (
    <section className="flex min-w-0 flex-col items-center gap-4">
      <header className="flex w-full max-w-[390px] flex-col gap-2">
        <h1 className="text-xl font-semibold">Tutorial phone preview</h1>
        <p className="text-sm text-space-300">
          390 × 844 px viewport. On smaller screens, the preview fits the available width.
        </p>
        <Link href="/arena/tutorial" className="tap inline-flex items-center text-sm text-ki-400 underline">
          Open tutorial directly
        </Link>
      </header>
      <iframe
        src="/arena/tutorial"
        title="Arena tutorial — 390 × 844 phone preview"
        width={390}
        height={844}
        className="block shrink-0 bg-space-950 outline outline-1 outline-space-700"
        style={{ width: 390, maxWidth: "100%", height: 844, border: 0 }}
      />
    </section>
  );
}
