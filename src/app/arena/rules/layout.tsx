import { RulesNavigation } from "./RulesNavigation";

export default function RulesLayout({ children }: { children: React.ReactNode }) {
  return <div className="ds-page space-y-5"><RulesNavigation />{children}</div>;
}
