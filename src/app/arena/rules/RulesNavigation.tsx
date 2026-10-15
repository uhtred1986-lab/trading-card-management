"use client";
import { usePathname } from "next/navigation";
import { SectionTabs } from "@/components/ui";
const items = [
  { href: "/arena/rules", label: "Workbench", match: (p: string) => p === "/arena/rules" || p.startsWith("/arena/rules/build/") },
  { href: "/arena/rules/review", label: "Review queue", match: (p: string) => p.startsWith("/arena/rules/review") },
  { href: "/arena/rules/keywords", label: "Keywords", match: (p: string) => p === "/arena/rules/keywords" },
  { href: "/arena/rules/language", label: "Language", match: (p: string) => p === "/arena/rules/language" },
  { href: "/arena/rules/game", label: "Ruleset", match: (p: string) => p === "/arena/rules/game" },
];
export function RulesNavigation() {
  const pathname = usePathname();
  return <SectionTabs items={items.map(({ href, label, match }) => ({ href, label, active: match(pathname) }))} label="Arena rules" />;
}
