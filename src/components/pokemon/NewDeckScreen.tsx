"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createPokemonDeckAction, importPokemonDeckListAction, type ImportListResponse } from "@/app/pokemon/decks/actions";
import { PK } from "@/lib/pokemon/copy";
import { POKEMON_FORMATS } from "@/lib/pokemon/types";
import { PageTop } from "./PageTop";
import { PokemonDeckFromCard, PokemonDeckWithClaude } from "./ClaudeBuild";
import { MiniArt } from "./DeckParts";

export interface NewDeckSeed {
  /** Catalog id, `PKM-sv03.5-006`. */
  id: string;
  name: string;
  imageUrl: string | null;
  setName: string;
  /** False when the card source could not be read: the id is all we know. */
  available: boolean;
}

/**
 * Neues Deck. With a card (`?card=`): its picture and the two ways to build around it, the free "Entwurf"
 * and Claude. Without: an empty deck, or Claude's builder. Both: paste a deck list from the Pokémon app or
 * a website. Every way ends on the new deck's page, which stamps its owner.
 */
export function NewDeckScreen({ seed, claudeEnabled }: { seed: NewDeckSeed | null; claudeEnabled: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [format, setFormat] = useState<string>(POKEMON_FORMATS[0]);
  const [error, setError] = useState<string | null>(null);
  const [creating, startCreate] = useTransition();

  const create = () =>
    startCreate(async () => {
      setError(null);
      const r = await createPokemonDeckAction({ name: name.trim() || PK.newDeck.defaultName, format });
      if (r.ok) router.push(`/pokemon/decks/${r.id}`);
      else setError(r.error);
    });

  return (
    <div className="pk-area">
      <PageTop title={seed ? PK.newDeck.withCardTitle : PK.newDeck.title} />

      {seed ? (
        <div className="pk-panel">
          <div className="pk-seed">
            <MiniArt src={seed.imageUrl} name={seed.name} label={`${seed.name}${seed.setName ? `, ${seed.setName}` : ""}`} />
            <div>
              <b>{seed.name}</b>
              {seed.setName ? <small>{seed.setName}</small> : null}
              <small>{PK.newDeck.withCardHint}</small>
            </div>
          </div>
          {!seed.available ? <p className="pk-note">{PK.newDeck.cardUnavailable}</p> : null}
          <PokemonDeckFromCard enabled={claudeEnabled} seed={{ id: seed.id, name: seed.name, imageUrl: seed.imageUrl, game: "pokemon", cardType: "POKEMON" }} />
        </div>
      ) : null}

      <div className="pk-panel">
        <label className="pk-field">
          <span>{PK.newDeck.nameLabel}</span>
          <input className="pk-input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={PK.newDeck.namePlaceholder} autoComplete="off" enterKeyHint="done" />
        </label>
        {/* With a card, the panel above already asks for the format; an empty deck then starts in the default one. */}
        {seed ? null : (
          <>
            <div className="pk-lbl" style={{ marginTop: 0 }} id="pk-newfmt">
              {PK.newDeck.formatLabel}
            </div>
            <div className="pk-chips" role="group" aria-labelledby="pk-newfmt">
              {POKEMON_FORMATS.map((f) => (
                <button key={f} type="button" className="pk-chip" aria-pressed={format === f} onClick={() => setFormat(f)}>
                  {PK.decks.formatNames[f]}
                </button>
              ))}
            </div>
          </>
        )}
        <button type="button" className="pk-cta" onClick={create} disabled={creating}>
          {creating ? PK.newDeck.creating : seed ? `＋ ${PK.newDeck.create}` : `＋ ${PK.newDeck.create}`}
        </button>
        {error ? (
          <p className="pk-error" role="alert">
            {error}
          </p>
        ) : null}
        <p className="pk-note">{PK.newDeck.sameFormatNote}</p>
      </div>

      {seed ? null : (
        <>
          <div className="pk-orline">{PK.newDeck.or}</div>
          <PokemonDeckWithClaude enabled={claudeEnabled} />
        </>
      )}

      <div className="pk-orline">{PK.newDeck.or}</div>
      <ImportList name={name} format={format} />

      <p style={{ marginTop: 16 }}>
        <Link href="/pokemon/decks" className="pk-linkbtn" style={{ display: "inline-flex", alignItems: "center" }}>
          ‹ {PK.decks.back}
        </Link>
      </p>
    </div>
  );
}

/** Paste a deck list: it is read at the card source, a deck is made from what was found and the rest is listed. */
function ImportList({ name, format }: { name: string; format: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ImportListResponse | null>(null);

  const submit = () =>
    start(async () => {
      setResult(null);
      let r: ImportListResponse;
      try {
        r = await importPokemonDeckListAction({ text, name: name.trim() || null, format });
      } catch {
        r = { ok: false, error: typeof navigator !== "undefined" && navigator.onLine === false ? PK.common.offline : PK.importList.failed };
      }
      // Everything found and nothing in doubt: straight into the deck. Otherwise say what is missing first.
      if (r.ok && r.unresolved.length === 0 && r.guessed.length === 0) router.push(`/pokemon/decks/${r.deckId}`);
      else setResult(r);
    });

  if (!open) {
    return (
      <button type="button" className="pk-cta pk-cta-alt" onClick={() => setOpen(true)}>
        {PK.importList.title}
      </button>
    );
  }

  return (
    <div className="pk-panel">
      <h2 className="pk-lbl" style={{ marginTop: 0, color: "var(--ds-ink)" }}>
        {PK.importList.title}
      </h2>
      <p className="pk-note" style={{ marginTop: 0 }}>
        {PK.importList.hint}
      </p>
      <label className="pk-field" style={{ marginTop: 10 }}>
        <span className="sr-only">{PK.importList.label}</span>
        <textarea className="pk-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={PK.importList.placeholder} spellCheck={false} autoCapitalize="off" autoCorrect="off" aria-label={PK.importList.label} />
      </label>
      <button type="button" className="pk-cta" onClick={submit} disabled={pending || !text.trim()}>
        {pending ? PK.importList.working : PK.importList.submit}
      </button>

      {result && !result.ok ? (
        <div role="alert">
          <p className="pk-error">{result.error}</p>
          {result.unresolved?.length ? <UnresolvedList lines={result.unresolved} /> : null}
        </div>
      ) : null}

      {result?.ok ? (
        <div role="status" className="pk-ok-note" style={{ marginTop: 12 }}>
          <p style={{ margin: 0 }}>{PK.importList.done(result.added, result.name)}</p>
          {result.unresolved.length > 0 ? <UnresolvedList lines={result.unresolved} /> : null}
          {result.guessed.length > 0 ? (
            <div>
              <p style={{ margin: "10px 0 0" }}>{PK.importList.guessedTitle}</p>
              <p className="pk-note" style={{ marginTop: 2 }}>
                {PK.importList.guessedHint}
              </p>
              <ul className="pk-list-unresolved">
                {result.guessed.map((g) => (
                  <li key={g.at}>
                    <code>{g.raw}</code> → {g.took}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <Link href={`/pokemon/decks/${result.deckId}`} className="pk-cta" style={{ marginTop: 12 }}>
            {PK.importList.openDeck}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function UnresolvedList({ lines }: { lines: { raw: string; at: number; reason: "unreadable" | "notFound" }[] }) {
  return (
    <div>
      <p style={{ margin: "10px 0 0" }}>{PK.importList.unresolvedTitle(lines.length)}</p>
      <p className="pk-note" style={{ marginTop: 2 }}>
        {PK.importList.unresolvedHint}
      </p>
      <ul className="pk-list-unresolved">
        {lines.map((l) => (
          <li key={l.at}>
            <code>{l.raw}</code> ({PK.importList.reasons[l.reason]})
          </li>
        ))}
      </ul>
    </div>
  );
}
