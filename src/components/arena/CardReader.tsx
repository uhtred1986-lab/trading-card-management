"use client";
import { useState } from "react";
import type { CardView } from "@/lib/arena/view";
import { cardImage } from "@/lib/catalog/card-image";
import { hasReviewedRulesArea, readerAbilities } from "./card-reader-model";
import styles from "./CardReader.module.css";

/** Inspection only. Reading or swiping a box can never submit a game action. */
export function CardReader({ card, showAbilities, direction }: { card: CardView; showAbilities: boolean; direction: "next" | "prev" }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const hasArt = !!card.imageUrl && failedImage !== card.imageUrl && !card.hidden;
  const abilities = readerAbilities(card);
  const anchored = hasReviewedRulesArea(card) && hasArt;
  const boxes = (copied: boolean) => abilities.filter(line => line.copied === copied).map(line => <button type="button" key={line.key} className={styles.ability} data-reader-ability={line.key} data-available={line.offered || undefined} aria-expanded={expanded === line.key} onClick={() => setExpanded(expanded === line.key ? null : line.key)}>
    <span className={styles.abilityHeading}><strong>{line.title}</strong><span>{line.state}</span></span>
    <span className={expanded === line.key ? styles.fullText : styles.excerpt}>{line.text}</span>
    <span className={styles.expandHint}>{expanded === line.key ? "Collapse" : "Read full ability"}</span>
  </button>);
  return <div className={styles.reader} data-card-reader data-reader-layout={anchored ? "anchored" : "tray"}>
    <div className={styles.face} data-reader-direction={direction} data-reader-face>
      {hasArt ? <>
        {/* eslint-disable-next-line @next/next/no-img-element -- use the best available original, without inventing image detail. */}
        <img src={cardImage(card.imageUrl!, "full")} alt={card.name} draggable={false} className={styles.art} onError={() => setFailedImage(card.imageUrl)} />
      </> : <div className={styles.placeholder}>{card.hidden ? "Face-down card" : card.name}</div>}
      {showAbilities && anchored && abilities.some(line => !line.copied) && <div className={styles.anchored} data-reader-boxes aria-label="Printed abilities over the card rules area">{boxes(false)}</div>}
    </div>
    {showAbilities && !card.hidden && (!anchored || abilities.some(line => line.copied)) && <div className={styles.tray} data-reader-boxes aria-label={anchored ? "Added abilities" : "Readable card abilities"}>{!anchored && boxes(false)}{boxes(true)}{!abilities.length && <p className={styles.empty}>No printed abilities on this card.</p>}</div>}
  </div>;
}
