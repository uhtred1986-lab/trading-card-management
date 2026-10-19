import { redirect } from "next/navigation";
import { requireSlPage } from "@/lib/auth";

/** The rules language now lives in the reference page's Language section (old links keep working). */
export default async function LanguageRedirect() {
  await requireSlPage();
  redirect("/arena/rules/reference#language");
}
