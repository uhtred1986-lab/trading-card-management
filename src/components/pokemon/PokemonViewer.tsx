"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addPokemonToDeckAction, setPokemonOwnedAction } from "@/app/pokemon/actions";
import { CardSwipeViewer, ViewerSheet, type SwipeItem } from "@/components/CardSwipeViewer";
import { PhotoOverride } from "@/components/PhotoOverride";
import { CardInfoError, fetchCardInfo, fetchEvolutions, numberLabel, type PokemonCardInfo, type PokemonEvolutions, type PokemonTile } from "@/lib/pokemon/client";
import { PK, stageLabel } from "@/lib/pokemon/copy";
import { POKEMON_FORMATS, pokemonPrintId, type PokemonVariant } from "@/lib/pokemon/types";
import { formatCents } from "@/lib/money";
import type { PokemonDeckRow } from "@/lib/pokemon/views";
import { CheckIcon, DeckIcon, HeartIcon } from "./icons";

type InfoState = PokemonCardInfo | "loading" | "unavailable" | "failed";

interface ViewerItem extends SwipeItem {
  tile: PokemonTile;
}

const total = (info: InfoState | undefined) => (info && typeof info === "object" ? info.owned.reduce((n, o) => n + o.quantity, 0) : null);

/**
 * The swipe viewer with the Pokémon verbs: Hab ich, Wunsch, Ins Deck and a detail sheet. The list
 * is whatever the screen shows (search results, the collection, the wishes). Each card's details,
 * price, variants and the viewer's copies come from `/api/pokemon/card/[id]` when it comes into view.
 */
export function PokemonViewer({
  tiles,
  startIndex,
  decks,
  wished,
  onToggleWish,
  onOwnedChange,
  onClose,
  targetDeck,
  onDeckAdded,
  onWishKnown,
}: {
  tiles: PokemonTile[];
  startIndex: number;
  decks: PokemonDeckRow[];
  wished: Set<string>;
  onToggleWish: (tile: PokemonTile) => void;
  /** The viewer's number of copies of a card changed (so the grid's badge follows). */
  onOwnedChange?: (cardId: string, copies: number) => void;
  onClose: () => void;
  /** Entdecken for a deck (`?deck=`): "Ins Deck" puts one copy straight into this deck instead of asking which. */
  targetDeck?: { id: number; name: string } | null;
  /** One copy went into `targetDeck`. */
  onDeckAdded?: (cardId: string) => void;
  /** A card the screen's list does not hold (reached through an evolution) turned out to be on the viewer's wishes: let the screen's hearts know. */
  onWishKnown?: (cardId: string) => void;
}) {
  const [infos, setInfos] = useState<Record<string, InfoState>>({});
  const asked = useRef(new Set<string>());
  // Cards reached through an evolution that the list does not hold: opened as one-off items at the end.
  const [extra, setExtra] = useState<PokemonTile[]>([]);
  const listed = useMemo(() => new Set(tiles.map((t) => t.id)), [tiles]);
  const all = useMemo(() => (extra.length ? [...tiles, ...extra] : tiles), [tiles, extra]);
  const onWishKnownRef = useRef(onWishKnown);
  useEffect(() => {
    onWishKnownRef.current = onWishKnown;
  });

  const load = useCallback((tile: PokemonTile, force = false) => {
    if (!force && asked.current.has(tile.tcgdexId)) return;
    asked.current.add(tile.tcgdexId);
    setInfos((m) => (m[tile.tcgdexId] && typeof m[tile.tcgdexId] === "object" ? m : { ...m, [tile.tcgdexId]: "loading" }));
    fetchCardInfo(tile.tcgdexId)
      .then((info) => {
        setInfos((m) => ({ ...m, [tile.tcgdexId]: info }));
        if (info.wished) onWishKnownRef.current?.(tile.id);
      })
      .catch((e) => {
        asked.current.delete(tile.tcgdexId);
        setInfos((m) => ({ ...m, [tile.tcgdexId]: e instanceof CardInfoError && e.kind === "unavailable" ? "unavailable" : "failed" }));
      });
  }, []);

  const items: ViewerItem[] = useMemo(
    () =>
      all.map((tile) => {
        const info = infos[tile.tcgdexId];
        const loaded = info && typeof info === "object" ? info : null;
        const kind = loaded ? [loaded.hit.types.join(" / "), loaded.details.hp ? `${PK.detail.hp} ${loaded.details.hp}` : "", stageLabel(loaded.details.stage ?? null) ?? ""].filter(Boolean).join(" · ") : "";
        const price = loaded?.hit.priceCents ?? tile.priceCents ?? null;
        return {
          id: tile.id,
          tile,
          image: tile.photoId ? `/api/card-photo/${tile.photoId}` : (tile.imageHigh ?? loaded?.imageHigh ?? null),
          alt: `${tile.name}, ${tile.setName} ${numberLabel(tile)}`,
          title: tile.name,
          subtitle: [[tile.altName, tile.setName, numberLabel(tile)].filter(Boolean).join(" · "), kind].filter(Boolean),
          side: price != null ? <strong>{formatCents(price)}</strong> : undefined,
        };
      }),
    [all, infos],
  );

  return (
    <CardSwipeViewer<ViewerItem>
      items={items}
      startIndex={startIndex}
      onClose={onClose}
      onActive={(item) => load(item.tile)}
      labels={{ close: PK.viewer.close, position: PK.viewer.position, previous: PK.viewer.previous, next: PK.viewer.next, details: PK.viewer.details, detailsAria: PK.viewer.detailsAria, cardOf: PK.viewer.cardOf, noImage: PK.common.noImage }}
      renderFooter={(ctx) => (
        <PokemonFooter
          key={ctx.item.tile.tcgdexId}
          tile={ctx.item.tile}
          info={infos[ctx.item.tile.tcgdexId]}
          decks={decks}
          wished={wished.has(ctx.item.tile.id)}
          onToggleWish={onToggleWish}
          onOwned={(info, copies) => {
            setInfos((m) => ({ ...m, [ctx.item.tile.tcgdexId]: info }));
            onOwnedChange?.(ctx.item.tile.id, copies);
          }}
          onRetry={() => load(ctx.item.tile, true)}
          targetDeck={targetDeck ?? null}
          onDeckAdded={onDeckAdded}
        />
      )}
      detailColumn
      renderDetail={(ctx) => (
        <PokemonDetail
          tile={ctx.item.tile}
          info={infos[ctx.item.tile.tcgdexId]}
          onRetry={() => load(ctx.item.tile, true)}
          onJump={(to) => {
            // A card of the list is jumped to; any other is opened as a one-off item at the end of it.
            if (!listed.has(to.id) && !extra.some((x) => x.id === to.id)) setExtra((list) => [...list, to]);
            ctx.jumpTo(to.id);
          }}
        />
      )}
    />
  );
}

// ── The three verbs ──────────────────────────────────────────────────────────

function PokemonFooter({
  tile,
  info,
  decks,
  wished,
  onToggleWish,
  onOwned,
  onRetry,
  targetDeck,
  onDeckAdded,
}: {
  tile: PokemonTile;
  info: InfoState | undefined;
  decks: PokemonDeckRow[];
  wished: boolean;
  onToggleWish: (tile: PokemonTile) => void;
  onOwned: (info: PokemonCardInfo, copies: number) => void;
  onRetry: () => void;
  targetDeck: { id: number; name: string } | null;
  onDeckAdded?: (cardId: string) => void;
}) {
  const [sheet, setSheet] = useState<"have" | "deck" | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pulse, setPulse] = useState(false);
  const [adding, setAdding] = useState(false);
  const owned = total(info);
  const say = (text: string) => {
    setStatus(text);
    window.setTimeout(() => setStatus((s) => (s === text ? null : s)), 3500);
  };
  async function addToTarget() {
    if (!targetDeck || adding) return;
    setAdding(true);
    try {
      await addPokemonToDeckAction({ deckId: targetDeck.id, tcgdexId: tile.tcgdexId, quantity: 1 });
      onDeckAdded?.(tile.id);
      say(PK.deck.added(targetDeck.name));
    } catch {
      say(typeof navigator !== "undefined" && navigator.onLine === false ? PK.common.offline : PK.common.error);
    }
    setAdding(false);
  }

  return (
    <>
      <div className="csv-verbs">
        <button type="button" className="csv-big" data-on={owned ? 1 : 0} onClick={() => setSheet("have")}>
          <CheckIcon />
          {owned ? PK.verbs.haveCount(owned) : PK.verbs.have}
        </button>
        <button
          type="button"
          className="csv-big csv-heart"
          aria-pressed={wished}
          data-pulse={pulse ? 1 : 0}
          onClick={() => {
            setPulse(true);
            window.setTimeout(() => setPulse(false), 200);
            onToggleWish(tile);
          }}
        >
          <HeartIcon />
          {wished ? PK.verbs.wished : PK.verbs.wish}
        </button>
        <button type="button" className="csv-big" disabled={adding} onClick={() => (targetDeck ? void addToTarget() : setSheet("deck"))}>
          <DeckIcon />
          {PK.verbs.deck}
        </button>
      </div>
      <p role="status" aria-live="polite" className={status ? "csv-status" : "sr-only"}>
        {status}
      </p>
      {sheet === "have" ? <HaveSheet tile={tile} info={info} onRetry={onRetry} onClose={() => setSheet(null)} onSaved={(next, copies) => { onOwned(next, copies); setSheet(null); say(PK.have.saved); }} /> : null}
      {sheet === "deck" ? <DeckSheet tile={tile} decks={decks} onClose={() => setSheet(null)} onAdded={(name) => { setSheet(null); say(PK.deck.added(name)); }} /> : null}
    </>
  );
}

const LANGS = [
  { value: "DE", label: PK.common.german },
  { value: "EN", label: PK.common.english },
] as const;

function HaveSheet({ tile, info, onRetry, onClose, onSaved }: { tile: PokemonTile; info: InfoState | undefined; onRetry: () => void; onClose: () => void; onSaved: (info: PokemonCardInfo, copies: number) => void }) {
  const router = useRouter();
  const loaded = info && typeof info === "object" ? info : null;
  const variants: PokemonVariant[] = loaded ? loaded.variants.map((v) => v.variant) : ["normal"];
  const mostOwned = loaded ? [...loaded.owned].sort((a, b) => b.quantity - a.quantity)[0] : undefined;
  const [variant, setVariant] = useState<PokemonVariant>(mostOwned?.variant ?? variants[0]);
  const [language, setLanguage] = useState<"DE" | "EN">(mostOwned?.language ?? "DE");
  const countOf = (v: PokemonVariant, l: "DE" | "EN") => loaded?.owned.find((o) => o.variant === v && o.language === l)?.quantity ?? 0;
  const [qty, setQty] = useState(() => countOf(variant, language) || 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = (v: PokemonVariant, l: "DE" | "EN") => {
    setVariant(v);
    setLanguage(l);
    setQty(countOf(v, l) || 1);
  };
  const totalNow = total(info) ?? 0;
  const label = (v: PokemonVariant) => PK.have.variantLabels[v] ?? loaded?.variants.find((x) => x.variant === v)?.label ?? v;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await setPokemonOwnedAction({ tcgdexId: tile.tcgdexId, variant, language, quantity: qty });
      const lines = (loaded?.owned ?? []).filter((o) => !(o.variant === variant && o.language === language));
      if (qty > 0) lines.push({ printId: pokemonPrintId(tile.tcgdexId, variant), variant, language, quantity: qty });
      const base = loaded ?? ({ hit: { id: tile.id, tcgdexId: tile.tcgdexId, name: tile.name, altName: tile.altName, setName: tile.setName, localId: tile.localId, setTotal: tile.setTotal, category: null, types: [], image: null, priceCents: tile.priceCents ?? null, lowCents: null, variants: [], legal: null }, details: {}, variants: [], rarity: null, setId: "", setLogo: null, imageHigh: tile.imageHigh, wished: false } satisfies Omit<PokemonCardInfo, "owned">);
      const next: PokemonCardInfo = { ...base, owned: lines };
      onSaved(next, lines.reduce((n, o) => n + o.quantity, 0));
      router.refresh();
    } catch {
      setError(typeof navigator !== "undefined" && navigator.onLine === false ? PK.common.offline : PK.common.error);
      setBusy(false);
    }
  }

  return (
    <ViewerSheet title={PK.have.title} onClose={onClose} closeLabel={PK.common.close}>
      <p className="pk-note" style={{ marginTop: 0 }}>
        {totalNow > 0 ? PK.have.youHave(totalNow) : PK.have.noneYet}
      </p>
      {info === "unavailable" || info === "failed" ? (
        <p className="pk-error" role="alert">
          {PK.viewer.detailsFailed}{" "}
          <button type="button" className="pk-chip" onClick={onRetry}>
            {PK.common.retry}
          </button>
        </p>
      ) : null}
      <div className="pk-lbl">{PK.have.variant}</div>
      <div className="pk-row" role="group" aria-label={PK.have.variant}>
        {variants.map((v) => (
          <button key={v} type="button" className="pk-chip" aria-pressed={variant === v} onClick={() => pick(v, language)}>
            {label(v)}
          </button>
        ))}
      </div>
      <div className="pk-lbl">{PK.have.language}</div>
      <div className="pk-row" role="group" aria-label={PK.have.language}>
        {LANGS.map((l) => (
          <button key={l.value} type="button" className="pk-chip" aria-pressed={language === l.value} onClick={() => pick(variant, l.value)}>
            {l.label}
          </button>
        ))}
      </div>
      <div className="pk-step" role="group" aria-label={PK.have.amount}>
        <button type="button" onClick={() => setQty((q) => Math.max(0, q - 1))} aria-label={PK.have.less} disabled={qty <= 0}>
          −
        </button>
        <output aria-live="polite">{qty}</output>
        <button type="button" onClick={() => setQty((q) => Math.min(99, q + 1))} aria-label={PK.have.more}>
          +
        </button>
      </div>
      {error ? (
        <p className="pk-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="button" className="pk-cta" onClick={save} disabled={busy}>
        {busy ? PK.common.saving : PK.have.save}
      </button>
    </ViewerSheet>
  );
}

function DeckSheet({ tile, decks, onClose, onAdded }: { tile: PokemonTile; decks: PokemonDeckRow[]; onClose: () => void; onAdded: (deckName: string) => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function add(deck: PokemonDeckRow) {
    setBusy(deck.id);
    setError(null);
    try {
      await addPokemonToDeckAction({ deckId: deck.id, tcgdexId: tile.tcgdexId, quantity: 1 });
      onAdded(deck.name);
    } catch {
      setError(typeof navigator !== "undefined" && navigator.onLine === false ? PK.common.offline : PK.common.error);
      setBusy(null);
    }
  }
  return (
    <ViewerSheet title={PK.deck.title} onClose={onClose} closeLabel={PK.common.close}>
      {decks.length === 0 ? <p className="pk-note" style={{ marginTop: 0 }}>{PK.deck.none}</p> : <div className="pk-lbl" style={{ marginTop: 0 }}>{PK.deck.choose}</div>}
      {decks.map((d) => (
        <button key={d.id} type="button" className="pk-opt" disabled={busy !== null} onClick={() => add(d)}>
          <DeckIcon />
          <span>
            {d.name}
            <small>{busy === d.id ? PK.common.saving : PK.deck.cardCount(d.count)}</small>
          </span>
        </button>
      ))}
      {error ? (
        <p className="pk-error" role="alert">
          {error}
        </p>
      ) : null}
      {/* Built by the decks lane: this link may not open anything yet. */}
      <Link href={`/pokemon/decks/new?card=${encodeURIComponent(tile.id)}`} prefetch={false} className="pk-opt">
        <span aria-hidden style={{ fontSize: 26, lineHeight: 1 }}>＋</span>
        <span>
          {PK.deck.newWithCard}
          <small>{PK.deck.newWithCardHint}</small>
        </span>
      </Link>
    </ViewerSheet>
  );
}

// ── The detail sheet ─────────────────────────────────────────────────────────

/**
 * "Entwickelt sich aus / zu" as rows of card pictures with names; a tap opens that card in the viewer.
 * Read live when the sheet opens; nothing is shown while it loads and when the source is down.
 */
function EvolutionRows({ tcgdexId, onJump }: { tcgdexId: string; onJump: (tile: PokemonTile) => void }) {
  const [evo, setEvo] = useState<PokemonEvolutions | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    fetchEvolutions(tcgdexId, ac.signal)
      .then(setEvo)
      .catch(() => {});
    return () => ac.abort();
  }, [tcgdexId]);
  if (!evo || (!evo.from && evo.into.length === 0)) return null;
  const row = (title: string, list: PokemonTile[]) => (
    <>
      <div className="pk-lbl">{title}</div>
      <ul className="pk-evo">
        {list.map((t) => (
          <li key={t.id}>
            <button type="button" className="tap" onClick={() => onJump(t)} aria-label={`${PK.detail.evolutionJump(t.name)}, ${t.setName}`}>
              {t.imageLow ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.imageLow} alt="" loading="lazy" decoding="async" />
              ) : null}
              <span>
                {t.name}
                {t.setName ? <small>{t.setName}</small> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
  return (
    <>
      {evo.from ? row(PK.detail.evolvesFrom, [evo.from]) : null}
      {evo.into.length ? row(PK.detail.evolvesInto, evo.into) : null}
    </>
  );
}

function PokemonDetail({ tile, info, onRetry, onJump }: { tile: PokemonTile; info: InfoState | undefined; onRetry: () => void; onJump: (tile: PokemonTile) => void }) {
  if (!info || info === "loading") return <p className="pk-note" role="status">{PK.viewer.loadingDetails}</p>;
  if (info === "unavailable" || info === "failed") {
    return (
      <p className="pk-error" role="alert">
        {PK.viewer.detailsFailed}{" "}
        <button type="button" className="pk-chip" onClick={onRetry}>
          {PK.common.retry}
        </button>
      </p>
    );
  }
  const d = info.details;
  const names = info.hit.altName ? `${info.hit.name} / ${info.hit.altName}` : info.hit.name;
  const owned = info.owned;
  const photoPrint = owned[0]?.printId ?? null;
  const price = info.hit.priceCents;
  const low = info.hit.lowCents;
  return (
    <div className="pk-detail">
      <dl>
        <dt>{PK.detail.names}</dt>
        <dd>{names}</dd>
        <dt>{PK.detail.set}</dt>
        <dd>
          {tile.setName || info.hit.setName} · {numberLabel(tile)}
        </dd>
        {d.hp ? (
          <>
            <dt>{PK.detail.hp}</dt>
            <dd>{d.hp}</dd>
          </>
        ) : null}
        {info.hit.types.length ? (
          <>
            <dt>{PK.detail.type}</dt>
            <dd>{info.hit.types.join(" / ")}</dd>
          </>
        ) : null}
        {d.stage ? (
          <>
            <dt>{PK.detail.kind}</dt>
            <dd>
              {d.display?.stage ?? stageLabel(d.stage)}
              {d.evolveFrom ? ` · ${PK.detail.evolvesFrom} ${d.evolveFrom}` : ""}
            </dd>
          </>
        ) : null}
        {d.weakness ? (
          <>
            <dt>{PK.detail.weakness}</dt>
            <dd>{d.weakness}</dd>
          </>
        ) : null}
        {d.retreat != null ? (
          <>
            <dt>{PK.detail.retreat}</dt>
            <dd>{d.retreat}</dd>
          </>
        ) : null}
        {info.rarity ? (
          <>
            <dt>{PK.detail.rarity}</dt>
            <dd>{info.rarity}</dd>
          </>
        ) : null}
        {d.legal ? (
          <>
            <dt>{PK.detail.format}</dt>
            <dd>
              {POKEMON_FORMATS.map((f, i) => (
                <span key={f}>
                  {i > 0 ? " · " : ""}
                  <span className={d.legal![f] ? "pk-ok" : "pk-bad"}>
                    {PK.detail.formatName(f)} {d.legal![f] ? PK.detail.allowed : PK.detail.notAllowed}
                  </span>
                </span>
              ))}
            </dd>
          </>
        ) : null}
        <dt>{PK.detail.price}</dt>
        <dd>
          {price != null ? formatCents(price, "EUR") : PK.common.priceUnknown}
          {price != null ? ` (${PK.common.priceNote})` : ""}
          {low != null && price != null && low !== price ? `, ${PK.detail.priceFrom} ${formatCents(low, "EUR")}` : ""}
        </dd>
      </dl>

      {(d.abilities ?? []).map((a) => (
        <div className="pk-atk" key={`ab-${a.name}`}>
          <b>
            <span>
              {PK.detail.abilities}: {a.name}
            </span>
          </b>
          {a.effect ? <p>{a.effect}</p> : null}
        </div>
      ))}
      {(d.attacks ?? []).map((a) => (
        <div className="pk-atk" key={a.name}>
          <b>
            <span>{a.name}</span>
            <span>{a.damage ?? ""}</span>
          </b>
          {a.effect ? <p>{a.effect}</p> : null}
        </div>
      ))}

      {info.hit.category === null || info.hit.category === "POKEMON" ? <EvolutionRows key={tile.tcgdexId} tcgdexId={tile.tcgdexId} onJump={onJump} /> : null}

      <div className="pk-lbl">{PK.detail.yourCopies}</div>
      {owned.length === 0 ? (
        <p className="pk-note" style={{ marginTop: 0 }}>{PK.detail.noCopies}</p>
      ) : (
        <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>
          {owned.map((o) => (
            <li key={`${o.printId}-${o.language}`}>{PK.detail.copyLine(PK.have.variantLabels[o.variant] ?? o.variant, o.language === "DE" ? PK.common.german : PK.common.english, o.quantity)}</li>
          ))}
        </ul>
      )}

      {photoPrint ? (
        <PhotoOverride className="mt-3" printId={photoPrint} photoId={info.photos?.[photoPrint] ?? tile.photoId ?? null} imageUrl={tile.imageLow ?? tile.imageHigh} alt={tile.name} labels={PK.photo} />
      ) : (
        <>
          <div className="pk-lbl">{PK.detail.ownPhoto}</div>
          <p className="pk-note" style={{ marginTop: 0 }}>{PK.detail.ownPhotoNeedsCard}</p>
        </>
      )}
    </div>
  );
}
