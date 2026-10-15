import { SettingsNavigation } from "./SettingsNavigation";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ds-settings-layout">
      <aside className="ds-settings-sidebar" aria-label="Settings sections">
        <p className="ds-eyebrow">Admin</p>
        <h2 className="mt-1 text-lg font-semibold">Settings</h2>
        <p className="ds-description">Manage your collection workspace.</p>
        <SettingsNavigation />
      </aside>
      <div className="ds-page min-w-0">{children}</div>
    </div>
  );
}
