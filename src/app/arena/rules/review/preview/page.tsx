import { notFound } from "next/navigation";
import { requireSlPage } from "@/lib/auth";
import { RuleExplanationPreview } from "@/components/arena/rules/RuleExplanationPreview";

export const dynamic = "force-dynamic";

/** Real guided review on synthetic actions; absent from production, no DB/model dependency. */
export default async function RuleExplanationPreviewPage({ searchParams }: { searchParams: Promise<{ outcome?: string }> }) {
  await requireSlPage();
  if (process.env.NODE_ENV === "production") notFound();
  const { outcome } = await searchParams;
  return <RuleExplanationPreview outcome={outcome ?? "supported"} />;
}
