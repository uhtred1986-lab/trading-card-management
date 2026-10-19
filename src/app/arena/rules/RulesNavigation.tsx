"use client";
import { usePathname } from "next/navigation";
import { SectionTabs } from "@/components/ui";
const items = [
  { href: "/arena/rules", label: "Rules", match: (p: string) => p === "/arena/rules" || p.startsWith("/arena/rules/card/") },
  { href: "/arena/rules/reference", label: "Reference", match: (p: string) => p.startsWith("/arena/rules/reference") },
];
export function RulesNavigation() {
  const pathname = usePathname();
  return <SectionTabs items={items.map(({ href, label, match }) => ({ href, label, active: match(pathname) }))} label="Arena rules" />;
}
