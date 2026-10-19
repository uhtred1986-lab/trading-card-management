import { redirect } from "next/navigation";
import { requireSlPage } from "@/lib/auth";

/** The ruleset as files now lives in the reference page's Ruleset section (old links keep working). */
export default async function RulesetRedirect() {
  await requireSlPage();
  redirect("/arena/rules/reference#ruleset");
}
