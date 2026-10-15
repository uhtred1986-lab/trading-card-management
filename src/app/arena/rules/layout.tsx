import { SectionTabs } from "@/components/ui";

const items = [
  { href: "/arena/rules", label: "Workbench" },
  { href: "/arena/rules/review", label: "Review queue" },
  { href: "/arena/rules/keywords", label: "Keywords" },
  { href: "/arena/rules/language", label: "Language" },
  { href: "/arena/rules/game", label: "Ruleset" },
  { href: "/arena/rules/patterns", label: "Patterns" },
];

export default function RulesLayout({ children }: { children: React.ReactNode }) {
  return <div className="ds-page space-y-5"><SectionTabs items={items} label="Arena rules" />{children}</div>;
}
