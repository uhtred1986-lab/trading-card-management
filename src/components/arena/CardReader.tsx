"use client";
import { useId, useState } from "react";
import type { CardView } from "@/lib/arena/view";
import { cardImage } from "@/lib/catalog/card-image";
import { useArenaAdmin } from "./admin-context";
import { chipKind, chipLabel, keywordBadge, readerAbilities, skillBody, skillShortName, type KeywordBadge } from "./card-reader-model";
import styles from "./CardReader.module.css";

/**
 * Reading one card (prototype scenarios "Look at a card" and "Review Claude's cards").
 *
 * The scan stays at its own size (never drawn wider than ~300 px). Over its lower half, where the
 * printed text is too small to read, a clean panel lists the skills the way the app words them:
 * a coloured keyword chip, a short name, and a "+" that opens that one skill's full text. The
 * "Full text" toggle opens them all. Inspection only: reading or swiping can never submit a game action.
 */
export function CardReader({ card, showAbilities, direction, docked = false }: { card: CardView; showAbilities: boolean; direction: "next" | "prev"; /** In the desktop inspector: the scan is sized to the inspector's height, not to a sheet of its own. */ docked?: boolean }) {
  const id = useId();
  const admin = useArenaAdmin();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [all, setAll] = useState(false);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const hasArt = !!card.imageUrl && failedImage !== card.imageUrl && !card.hidden;
  const abilities = readerAbilities(card);
  const isOpen = (key: string) => all || open.has(key);
  const toggle = (key: string) => {
    // Closing one row while "Full text" is on turns the others into single openings.
    const next = new Set(all ? abilities.map(line => line.key) : open);
    if (next.has(key)) next.delete(key); else next.add(key);
    setAll(false);
    setOpen(next);
  };
  const anyOpen = abilities.some(line => isOpen(line.key));
  const count = `${abilities.length} skill${abilities.length === 1 ? "" : "s"}`;
  const panel = <div className={styles.panel} data-reader-boxes data-reader-open={anyOpen || undefined} aria-label="Card skills">
    <div className={styles.head}>
      <span className={styles.count}>{admin ? `${card.cardId} · ` : ""}{count}</span>
      {abilities.length > 0 && <button type="button" className={styles.fullToggle} data-reader-full aria-pressed={all} onClick={e => { e.stopPropagation(); setAll(!all); setOpen(new Set()); }}>{all ? "Names only" : "Full text"}</button>}
    </div>
    {abilities.map((line, index) => {
      const expanded = isOpen(line.key);
      const textId = `${id}-${index}`;
      return <div key={line.key} className={styles.ability} data-reader-ability={line.key} data-available={line.offered || undefined} data-chip={chipKind(line.tag, line.keyword)}>
        <div className={styles.bar}>
          <span className={styles.chip}>{chipLabel(line.tag)}</span>
          <div className={styles.summary}>
            <p className={styles.name}>{skillShortName(line)}</p>
            {(line.extraTags.length > 0 || line.copied || line.offered || line.state === "Pending") && <span className={styles.note}>{[...line.extraTags, line.copied ? "Added" : line.offered ? "Available now" : line.state === "Pending" ? "Pending" : null].filter(Boolean).join(" · ")}</span>}
          </div>
          <button type="button" className={styles.info} data-reader-info aria-label={`${expanded ? "Hide" : "Read"} full text: ${line.title}`} aria-expanded={expanded} aria-controls={textId} onClick={e => { e.stopPropagation(); toggle(line.key); }}><span aria-hidden>{expanded ? "−" : "+"}</span></button>
        </div>
        {expanded && <div id={textId} className={styles.fullText} role="region" aria-label={`${line.title}, exact printed text`}><p>{line.text}</p></div>}
      </div>;
    })}
    {abilities.length === 0 && <p className={styles.empty}>No printed skills on this card.</p>}
  </div>;
  return <div className={styles.reader} data-card-reader data-reader-docked={docked || undefined} data-reader-layout={hasArt ? "anchored" : "tray"}>
    <div className={styles.face} data-reader-direction={direction} data-reader-face>
      {hasArt ? <>
        {/* eslint-disable-next-line @next/next/no-img-element -- use the best available original, without inventing image detail. */}
        <img data-reader-drag-handle src={cardImage(card.imageUrl!, "full")} alt={card.name} draggable={false} className={styles.art} onError={() => setFailedImage(card.imageUrl)} />
      </> : <div data-reader-drag-handle className={styles.placeholder}>{card.hidden ? "Face-down card" : card.name}</div>}
      {showAbilities && !card.hidden && hasArt && panel}
    </div>
    {showAbilities && !card.hidden && !hasArt && <div className={styles.tray}>{panel}</div>}
  </div>;
}

const PIP_NAME: Record<string, string> = { r: "red", u: "blue", g: "green", y: "yellow", b: "black" };

/** A keyword badge: its name and the values it carries; the reminder is its tooltip. */
function Badge({ badge }: { badge: KeywordBadge }) {
  const said = [badge.label, badge.count, badge.pips.length ? `cost ${badge.pips.map((p) => PIP_NAME[p] ?? p).join(" ")}` : null, badge.target ? `on ${badge.target}` : null].filter(Boolean).join(", ");
  return <span className={styles.kwBadge} data-deck={badge.deck || undefined} title={badge.reminder || undefined} aria-label={badge.reminder ? `${said}: ${badge.reminder}` : said}>
    <span>{badge.label}{badge.count ? ` ${badge.count}` : ""}</span>
    {badge.pips.length > 0 && <span className={styles.kwSlot} aria-hidden>{badge.pips.map((p, i) => <i key={i} className={styles.pip} data-pip={PIP_NAME[p] ? p : "n"}>{PIP_NAME[p] ? "" : p}</i>)}</span>}
    {badge.target && <span className={styles.kwSlot} aria-hidden>on {badge.target}</span>}
  </span>;
}

/**
 * Everything a card can do, at one glance (owner, 19 Oct 2026): for the desktop card column, where there
 * is room to write it out. Keywords are a strip of badges (their meaning never changes; the reminder is a
 * tooltip), then every other skill in full, with its type chip and its limits. Nothing is behind a "+".
 */
export function CardSkills({ card }: { card: CardView }) {
  if (card.hidden) return <p className={styles.empty}>Face-down card.</p>;
  const lines = readerAbilities(card);
  const badges: KeywordBadge[] = [];
  const rows = lines.filter((line) => {
    const badge = keywordBadge(line);
    if (badge) badges.push(badge);
    return !badge;
  });
  badges.sort((a, b) => Number(a.deck) - Number(b.deck));
  return <div className={styles.skills} data-card-skills={card.id}>
    {badges.length > 0 && <div className={styles.kwStrip} aria-label="Keywords">{badges.map((b) => <Badge key={b.key} badge={b} />)}</div>}
    {rows.map((line) => <div key={line.key} className={styles.skillRow} data-available={line.offered || undefined} data-chip={chipKind(line.tag, line.keyword)} data-reader-ability={line.key}>
      <div className={styles.skillHead}>
        <span className={styles.chip}>{chipLabel(line.tag)}</span>
        {line.extraTags.map((t) => <span key={t} className={styles.limit}>{chipLabel(t)}</span>)}
        {line.copied && <span className={styles.limit}>Added</span>}
        {line.offered && <span className={styles.now}>Available now</span>}
        {!line.offered && line.state === "Pending" && <span className={styles.limit}>Pending</span>}
      </div>
      <p className={styles.skillText}>{skillBody(line.text)}</p>
    </div>)}
    {lines.length === 0 && <p className={styles.empty}>No printed skills on this card.</p>}
  </div>;
}
