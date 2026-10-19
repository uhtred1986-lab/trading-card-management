import Link from "next/link";
import { languageReference } from "@/lib/arena/lang/reference";
import { loadDbs } from "@/lib/arena/rulesets";
import { requireSlPage } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { KeywordsReference } from "@/components/arena/rules/reference/Keywords";
import { LanguageReference } from "@/components/arena/rules/reference/Language";
import { RulesetReference } from "@/components/arena/rules/reference/Ruleset";

export const metadata = { title: "Arena rules reference" };

/**
 * The three SL reference sections in one page: keywords, the rules language
 * and the ruleset as files. The old `/arena/rules/keywords`, `/language` and
 * `/game` routes redirect here with the matching anchor.
 */
export default async function RulesReferencePage() {
  await requireSlPage();
  const loaded = loadDbs();
  const language = languageReference();

  return (
    <div className="space-y-10">
      <PageHeader title="Arena rules reference" eyebrow="Arena rules reference" description="The keywords the engine knows, the rules language, and the game as the engine reads it from files.">
        <Link href="/arena/rules" className="ml-auto text-xs text-space-300 hover:text-ki-300">
          ← The rules of your cards
        </Link>
      </PageHeader>

      <nav className="flex flex-wrap gap-1.5 text-[11px]">
        <a href="#keywords" className="tap rounded-md bg-space-900 px-2.5 py-1.5 text-space-300 hover:text-ki-300">
          Keywords
        </a>
        <a href="#language" className="tap rounded-md bg-space-900 px-2.5 py-1.5 text-space-300 hover:text-ki-300">
          Language
        </a>
        <a href="#ruleset" className="tap rounded-md bg-space-900 px-2.5 py-1.5 text-space-300 hover:text-ki-300">
          Ruleset
        </a>
      </nav>

      <KeywordsReference loaded={loaded} />
      <LanguageReference reference={language} />
      <RulesetReference loaded={loaded} />
    </div>
  );
}
