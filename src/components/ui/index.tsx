import Link from "next/link";
import type { ReactNode, HTMLAttributes } from "react";

/** Shared presentation only: callers retain authorization, data and actions. */
export function PageHeader({ title, eyebrow, description, actions, children }: { title: ReactNode; eyebrow?: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return <header className="ds-page-header"><div>{eyebrow && <p className="ds-eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="ds-description">{description}</p>}{children}</div>{actions && <div className="ds-actions">{actions}</div>}</header>;
}
export function Panel({ children, className = "", ...props }: HTMLAttributes<HTMLElement>) { return <section {...props} className={`ds-panel ${className}`}>{children}</section>; }
export function SectionTabs({ items, label = "Section navigation" }: { items: { href: string; label: string; active?: boolean }[]; label?: string }) { return <nav className="ds-tabs" aria-label={label}>{items.map(i => <Link key={i.href} href={i.href} aria-current={i.active ? "page" : undefined}>{i.label}</Link>)}</nav>; }
export function FilterBar({ children, more, active, summary }: { children: ReactNode; more?: ReactNode; active?: ReactNode; summary?: ReactNode }) { return <section className="ds-filter-bar" aria-label="Filters"><div className="ds-filter-primary">{children}{more && <details className="ds-more-filters"><summary className="tap ds-button-secondary">More filters</summary><div className="ds-filter-extra">{more}</div></details>}</div>{active && <div className="ds-filter-chips">{active}</div>}{summary && <div className="ds-filter-summary" role="status">{summary}</div>}</section>; }
export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) { return <Panel className="ds-empty"><h2>{title}</h2>{children && <p>{children}</p>}{action}</Panel>; }

/** URL-backed chips remove one facet without dropping game, view or repeated deck parameters. */
export function ActiveFilterChips({ path, params, keys }: { path: string; params: Record<string, string | string[] | number | undefined>; keys: string[] }) {
  const href = (removed: string[]) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (removed.includes(key) || key === "page" || value == null || value === "") continue;
      for (const item of Array.isArray(value) ? value : [value]) query.append(key, String(item));
    }
    return query.size ? `${path}?${query}` : path;
  };
  const active = keys.filter(key => params[key] != null && params[key] !== "" && (!Array.isArray(params[key]) || params[key].length));
  if (!active.length) return null;
  return <>{active.map(key => <Link key={key} href={href([key])} aria-label={`Remove ${key} filter`}>{key}: {Array.isArray(params[key]) ? params[key].join(", ") : params[key]} <span aria-hidden>×</span></Link>)}<Link href={href(keys)}>Clear filters</Link></>;
}
