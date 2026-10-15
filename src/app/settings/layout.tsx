import Link from "next/link";
import { Panel, PageHeader } from "@/components/ui";

const sections = [
  ["Appearance", "/settings#appearance"],
  ["AI & integrations", "/settings#ai"],
  ["Data & sync", "/settings#sync"],
  ["Storage locations", "/settings/locations"],
  ["Users & access", "/settings/access"],
] as const;

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ds-settings-layout">
      <aside className="ds-settings-sidebar" aria-label="Settings sections">
        <PageHeader title="Settings" eyebrow="Admin" description="Manage your collection workspace." />
        <nav className="mt-4 flex gap-2 overflow-x-auto sm:flex-col" aria-label="Settings navigation">
          {sections.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
        </nav>
      </aside>
      <div className="ds-page min-w-0">{children}</div>
    </div>
  );
}
