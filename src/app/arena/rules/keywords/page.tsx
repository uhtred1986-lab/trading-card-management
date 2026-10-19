import { redirect } from "next/navigation";
import { requireSlPage } from "@/lib/auth";

/** The keywords now live in the reference page's Keywords section (old links keep working). */
export default async function KeywordsRedirect() {
  await requireSlPage();
  redirect("/arena/rules/reference#keywords");
}
