"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { addPokemonLotAction, setPokemonOwnedAction, undoPokemonDeckAddAction } from "@/app/pokemon/actions";
import { resolveSpokenPokemonAction, type SpokenPokemonResolution } from "@/app/pokemon/add/actions";
import { INPUT_COPY, failureText } from "@/lib/pokemon/copy-input";
import { pokemonImage, type PokemonHit, type PokemonVariant } from "@/lib/pokemon/types";
import { cue } from "@/lib/scan/cue";
import { speechSupported, startListening, type SpeechSession } from "@/lib/scan/speech";
import { defaultSpeechLang, readSpeechLang, rememberSpeechLang, speechLangCode, type SpeechLang } from "@/lib/scan/speech-lang";
import { CandidateTile, ChipRow, DeckSelect, Stepper, loadCardDetail, numberLabel, primaryButton, secondaryButton, variantOptions, type CardDetailLite, type DeckChoice } from "./AddParts";

const C = INPUT_COPY.voice;

interface Saved {
  key: number;
  tcgdexId: string;
  name: string;
  image: string | null;
  variant: PokemonVariant;
  variantLabel: string;
  language: "DE" | "EN";
  added: number;
  number: string;
  /** The deck this line also put copies into, how many, and how many the deck held of the card before: the undo takes back exactly these. */
  deckId: number | null;
  deckAdded: number;
  deckBefore: number;
}

type Phase = "idle" | "resolving" | "pick" | "none" | "unavailable";

let savedKey = 1;
const LANG_EVENT = "pokemon-speech-lang";
function subscribeLang(onChange: () => void): () => void {
  window.addEventListener(LANG_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(LANG_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
const countKey = (tcgdexId: string, variant: string, language: string) => `${tcgdexId}|${variant}|${language}`;

/**
 * Vorlesen (docs/pokemon/design.md §5): the browser listens (no audio is uploaded), the heard words
 * become cards to tap, then variant, language and number, then "Speichern und weiter" saves and
 * opens the microphone again. Nothing is saved on a guess: every card is a tap, and the save is a
 * button.
 */
export function PokemonVoiceAdd({ decks, initialDeck }: { decks: DeckChoice[]; initialDeck: number | null }) {
  // Whether the API exists is a client-only fact; read after hydration so the markup agrees.
  const supported = useSyncExternalStore(
    () => () => {},
    () => speechSupported(),
    () => true,
  );
  // The last choice on this device wins over the game's default; the server and first paint use the default.
  const lang = useSyncExternalStore(subscribeLang, () => readSpeechLang("pokemon"), () => defaultSpeechLang("pokemon"));
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [heard, setHeard] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [res, setRes] = useState<SpokenPokemonResolution | null>(null);
  const [chosen, setChosen] = useState<PokemonHit | null>(null);
  const [detail, setDetail] = useState<CardDetailLite | null>(null);
  const [variant, setVariant] = useState<PokemonVariant>("normal");
  const [cardLang, setCardLang] = useState<"DE" | "EN">("DE");
  const [quantity, setQuantity] = useState(1);
  const [deckId, setDeckId] = useState<number | null>(initialDeck);
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [showList, setShowList] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sessionRef = useRef<SpeechSession | null>(null);
  /** The viewer's known count per card, variant and language, kept in step with what this screen saved: an undo goes back by exactly what its line added. */
  const counts = useRef(new Map<string, number>());
  /** Which request is the latest, so a slow answer never overwrites a newer one. */
  const ticket = useRef(0);

  useEffect(() => () => sessionRef.current?.stop(), []);

  const changeLang = (l: SpeechLang) => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setListening(false);
    rememberSpeechLang(l);
    window.dispatchEvent(new Event(LANG_EVENT));
  };

  const choose = useCallback(async (hit: PokemonHit, quantityHeard: number | null | undefined, spoken: SpeechLang) => {
    const mine = ++ticket.current;
    setChosen(hit);
    // The card's language starts as the one she spoke in.
    setCardLang(speechLangCode(spoken) === "de" ? "DE" : "EN");
    setDetail(null);
    setError(null);
    setNotice(null);
    if (quantityHeard) setQuantity(quantityHeard);
    try {
      const d = await loadCardDetail(hit.tcgdexId);
      if (mine !== ticket.current) return;
      setDetail(d);
      setVariant(d.variants.some((v) => v.variant === "normal") || d.variants.length === 0 ? "normal" : d.variants[0].variant);
    } catch (e) {
      if (mine === ticket.current) setError(failureText(e, INPUT_COPY.voice.saveFailed));
    }
  }, []);

  const heardSomething = useCallback(
    async (alternatives: string[]) => {
      const mine = ++ticket.current;
      setHeard(alternatives[0] ?? "");
      setInterim("");
      setPhase("resolving");
      setChosen(null);
      setDetail(null);
      setError(null);
      setNotice(null);
      try {
        const r = await resolveSpokenPokemonAction({ alternatives, lang: speechLangCode(lang) });
        if (mine !== ticket.current) return;
        setRes(r);
        setQuantity(r.quantity ?? 1);
        if (r.status === "found") {
          cue("ok");
          setPhase("pick");
          // One exact match skips the row.
          if (r.candidates.length === 1) void choose(r.candidates[0], r.quantity, lang);
        } else {
          setPhase(r.status === "unavailable" ? "unavailable" : "none");
        }
      } catch {
        if (mine !== ticket.current) return;
        setPhase("unavailable");
      }
    },
    [choose, lang],
  );

  const stopMic = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setListening(false);
  }, []);

  const startMic = useCallback(() => {
    sessionRef.current?.stop();
    setError(null);
    setInterim("");
    const session = startListening(
      {
        onFinal: (alts) => {
          // One phrase at a time: stop listening while the cards are shown.
          sessionRef.current?.stop();
          sessionRef.current = null;
          setListening(false);
          void heardSomething(alts);
        },
        onInterim: setInterim,
        onError: () => {
          setListening(false);
          setError(C.micError);
        },
        onStop: () => setListening(false),
      },
      lang,
    );
    sessionRef.current = session;
    if (!session) setError(C.micError);
    setListening(!!session);
  }, [heardSomething, lang]);

  const submitTyped = (e: React.FormEvent) => {
    e.preventDefault();
    const text = typed.trim();
    if (!text) return;
    stopMic();
    void heardSomething([text]);
  };

  const save = async () => {
    if (!chosen || !detail || saving) return;
    const snapshot = { hit: chosen, variant, language: cardLang, quantity, deckId };
    const label = detail.variants.find((v) => v.variant === variant)?.label ?? variant;
    // Opening the microphone has to happen inside the tap to count as a user gesture on a phone.
    startMic();
    setSaving(true);
    setError(null);
    try {
      const key = countKey(snapshot.hit.tcgdexId, snapshot.variant, snapshot.language);
      const before = counts.current.get(key) ?? detail.owned.find((l) => l.variant === snapshot.variant && l.language === snapshot.language)?.quantity ?? 0;
      const r = await addPokemonLotAction({ tcgdexId: snapshot.hit.tcgdexId, variant: snapshot.variant, language: snapshot.language, quantity: snapshot.quantity, deckId: snapshot.deckId });
      counts.current.set(key, before + r.added);
      setSaved((s) => [
        { key: savedKey++, tcgdexId: snapshot.hit.tcgdexId, name: snapshot.hit.name, image: snapshot.hit.image, variant: snapshot.variant, variantLabel: label, language: snapshot.language, added: r.added, number: numberLabel(snapshot.hit), deckId: snapshot.deckId, deckAdded: r.deckAdded, deckBefore: r.deckBefore },
        ...s,
      ]);
      setNotice(null);
      setChosen(null);
      setDetail(null);
      setRes(null);
      setHeard("");
      setPhase("idle");
      setQuantity(1);
      cue("ok");
    } catch (e) {
      stopMic();
      setError(failureText(e, C.saveFailed));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Undo of one line: the count goes back by exactly what that line added (`setPokemonOwnedAction`
   * archives the newest copies, which the app keeps restorable), and so does the deck: the copies this
   * line put into the chosen deck come out again, never below what the deck held before it
   * (`undoPokemonDeckAddAction`). A deck she has changed since keeps its other changes.
   */
  const undo = async (line: Saved) => {
    const key = countKey(line.tcgdexId, line.variant, line.language);
    const known = counts.current.get(key) ?? line.added;
    try {
      const r = await setPokemonOwnedAction({ tcgdexId: line.tcgdexId, variant: line.variant, language: line.language, quantity: Math.max(0, known - line.added) });
      counts.current.set(key, r.quantity);
      setSaved((s) => s.filter((x) => x.key !== line.key));
      let text: string = C.undone;
      if (line.deckId !== null && line.deckAdded > 0) {
        try {
          const d = await undoPokemonDeckAddAction({ deckId: line.deckId, tcgdexId: line.tcgdexId, added: line.deckAdded, before: line.deckBefore });
          text = `${C.undone}. ${d.removed > 0 ? C.deckRemoved(d.removed) : C.deckUnchanged}`;
        } catch (e) {
          text = `${C.undone}. ${failureText(e, C.deckUnchanged)}`;
        }
      }
      setNotice(text);
    } catch (e) {
      setError(failureText(e, C.saveFailed));
    }
  };

  const total = saved.reduce((n, s) => n + s.added, 0);
  const shownText = listening ? interim : heard;
  const langCode = speechLangCode(lang);

  if (showList) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <header className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold text-space-50">{C.sessionTitle}</h1>
          <span className="rounded-full bg-space-800 px-3 py-1 text-sm font-semibold text-space-100">{C.newCount(total)}</span>
        </header>
        {notice ? <p role="status" className="text-sm text-space-200">{notice}</p> : null}
        {error ? <p role="alert" className="text-sm text-loss">{error}</p> : null}
        {saved.length === 0 ? (
          <p className="text-sm text-space-300">{C.sessionEmpty}</p>
        ) : (
          <ul className="divide-y divide-space-800 rounded-xl border border-space-700/70">
            {saved.map((s) => {
              const src = pokemonImage(s.image, "low");
              return (
                <li key={s.key} className="flex items-center gap-3 px-2 py-2">
                  <span className="card-aspect w-10 shrink-0 overflow-hidden rounded bg-space-800">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt={`${s.name} ${s.number}`} loading="lazy" className="h-full w-full object-cover" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-space-50">{s.name}</span>
                    <span className="block text-xs text-space-300">
                      ×{s.added} · {s.variantLabel} · {s.language} · {s.number}
                    </span>
                  </span>
                  <button type="button" onClick={() => undo(s)} className={secondaryButton}>
                    {C.undo}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <button type="button" onClick={() => setShowList(false)} className={primaryButton}>
          {C.back}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-5">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-space-50">{C.title}</h1>
        <span className="rounded-full bg-space-800 px-3 py-1 text-sm font-semibold text-space-100" aria-live="polite">
          {C.newCount(total)}
        </span>
      </header>

      <ChipRow
        label={C.listenIn}
        value={lang}
        options={[
          { value: "de-AT", label: C.langDe },
          { value: "en-US", label: C.langEn },
        ]}
        onChange={changeLang}
      />

      <div className="flex flex-col items-center gap-3">
        {supported ? (
          <button
            type="button"
            onClick={listening ? stopMic : startMic}
            aria-pressed={listening}
            aria-label={listening ? C.micStop : C.micStart}
            className={`tap flex h-24 w-24 items-center justify-center rounded-full border-2 text-4xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ki-300 ${listening ? "border-ki-400 bg-ki-500/25 motion-safe:animate-pulse" : "border-space-600 bg-space-900 hover:bg-space-800"}`}
          >
            <span aria-hidden>🎤</span>
          </button>
        ) : (
          <div role="status" className="w-full rounded-xl border border-space-700 bg-space-900/60 p-3 text-center text-sm text-space-200">
            <p>{C.noSpeech}</p>
            <Link href="/pokemon/discover" className="tap mt-2 inline-flex items-center rounded-lg border border-space-600 px-4 py-2 font-medium text-space-50 hover:bg-space-800">
              {C.toSearch}
            </Link>
          </div>
        )}
        <p className="min-h-8 text-center text-sm text-space-300" aria-live="polite">
          {phase === "resolving" ? C.resolving : listening ? C.listening : !shownText && supported ? C.idle : ""}
        </p>
        {shownText ? (
          <p className="text-center text-3xl font-semibold leading-tight text-space-50" aria-label={C.heardLabel}>
            „{shownText}“
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-loss/40 bg-loss/5 p-3 text-sm text-loss">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-space-200">
          {notice}
        </p>
      ) : null}
      {phase === "none" ? <p className="text-center text-sm text-space-200">{C.nothing}</p> : null}
      {phase === "unavailable" ? <p className="text-center text-sm text-loss">{C.unavailable}</p> : null}

      {res && res.status === "found" && phase === "pick" ? (
        <section aria-label={C.pick} className="space-y-2">
          <h2 className="text-sm font-semibold text-space-200">{res.candidates.length === 1 ? C.exactOne : C.pick}</h2>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
            {res.candidates.map((h) => (
              <CandidateTile key={h.id} hit={h} owned={res.owned[h.id]} ownLabel={C.own} selected={chosen?.id === h.id} onPick={(x) => void choose(x, res.quantity, lang)} />
            ))}
          </div>
        </section>
      ) : null}

      {chosen ? (
        <section className="space-y-4 rounded-2xl border border-space-700/70 bg-space-900/50 p-3" aria-label={chosen.name}>
          <div className="text-center">
            <div className="text-lg font-semibold text-space-50">{chosen.name}</div>
            <div className="text-sm text-space-300">
              {chosen.setName} · {numberLabel(chosen)}
            </div>
          </div>
          {detail ? (
            <>
              <ChipRow label={C.variant} value={variant} options={variantOptions(detail.variants)} onChange={setVariant} />
              <ChipRow
                label={C.language}
                value={cardLang}
                options={[
                  { value: "DE", label: C.langDe },
                  { value: "EN", label: C.langEn },
                ]}
                onChange={setCardLang}
              />
              <Stepper value={quantity} onChange={setQuantity} lessLabel={C.less} moreLabel={C.more} />
              <DeckSelect decks={decks} value={deckId} onChange={setDeckId} label={INPUT_COPY.hub.deck.label} none={INPUT_COPY.hub.deck.none} />
              <button type="button" onClick={save} disabled={saving} className={primaryButton}>
                {saving ? C.saving : `✓ ${C.save}`}
              </button>
            </>
          ) : !error ? (
            <p className="text-center text-sm text-space-300">{C.resolving}</p>
          ) : null}
        </section>
      ) : null}

      <form onSubmit={submitTyped} className="space-y-1">
        <label htmlFor="pokemon-typed" className="text-xs font-semibold uppercase tracking-wider text-space-300">
          {C.typedLabel}
        </label>
        <div className="flex gap-2">
          <input
            id="pokemon-typed"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={C.typedPlaceholder}
            autoComplete="off"
            enterKeyHint="search"
            lang={langCode}
            className="tap min-w-0 flex-1 rounded-lg border border-space-600 bg-space-900 px-3 py-2 text-base text-space-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ki-400"
          />
          <button type="submit" className={secondaryButton}>
            {C.typedGo}
          </button>
        </div>
      </form>

      <button type="button" onClick={() => { stopMic(); setShowList(true); }} className={primaryButton}>
        {C.done}
      </button>
    </div>
  );
}
