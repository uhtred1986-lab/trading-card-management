"use client";

import Link from "next/link";
import type { ArenaSkin } from "@/lib/arena/skin";
import type { ArenaStaging } from "@/lib/arena/staging";
import type { TurnLighting } from "@/lib/arena/lighting";
import { useMatchScreen } from "@/lib/match-screen";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArenaStage } from "../stage/ArenaStage";
import { AnnouncerPortrait } from "./AnnouncerPortrait";
import { createPracticeSession, restorePracticeSession, type PracticeSession } from "@/lib/arena/tutorial/session";
import { CURRICULUM_VERSION, LESSONS, affordabilityPrompt, compactCoach, BADGE_GLOSSARY, currentLesson, handoffReady, initialProgress, lessonReducer, type LearningEvent, type LearningProgress } from "@/lib/arena/tutorial/lessons";
import styles from "./tutorial.module.css";

const KEY = "arena:masters-first-match:classic-v2";
type BoardStatus = { busy: boolean; reviewOpen: boolean; targeting: boolean };
interface Saved { version: string; session: unknown; progress: LearningProgress; intro: number | null; hints: boolean; handoff: boolean }
function validProgress(p: LearningProgress): boolean {
  return !!p && p.version === CURRICULUM_VERSION && Number.isInteger(p.revision) && Number.isInteger(p.ownTurns) && Number.isInteger(p.lastTurn) && Array.isArray(p.completed) && p.completed.every(x => typeof x === "string") && Array.isArray(p.skipped) && p.skipped.every(x => typeof x === "string") && !!p.predictions && typeof p.predictions === "object" && [p.defended, p.attacked, p.ownBattleResolved].every(x => typeof x === "boolean");
}

const TITLES: Record<string, string> = {
  "classic.evolve": "Evolve a Battle Card", "classic.awaken": "Goku can Awaken!", "classic.response": "Counter or Blocker?", "classic.choice": "Your card ability needs a choice", "classic.cleanup": "Where does the combo card go?",
  "t1.charge": "Charge a card, or keep your hand", "t1.affordability": "Can you pay the cost?", "t1.play": "Inspect, review and play", "t1.first-turn": "Your first turn", "t1.end": "End your Main Phase", "opp.observe": "Watch the other player", "opp.attack-predict": "Predict the battle", "opp.defend": "Choose your defense", "opp.tie": "Compare the final power", "t2.refresh": "Your cards refresh", "t2.charge": "Plan your next energy", "t2.attack-target": "Choose an attacker and target", "t2.offense-combo": "Add a combo, or continue", "t2.resolve": "Watch the battle resolve", "changed-board.predict": "What would you do next?", "wrapup": "Your practice match"
};
export function Tutorial({ skin, staging, lighting }: { skin?: ArenaSkin; staging?: ArenaStaging; lighting?: TurnLighting }) {
  useMatchScreen();
  const [generation, setGeneration] = useState(0);
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [progress, setProgress] = useState(initialProgress);
  const progressRef = useRef(progress);
  const [intro, setIntro] = useState<number | null>(0);
  const [hints, setHints] = useState(true);
  const [handoff, setHandoff] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [why, setWhy] = useState(false);
  const [nextMove, setNextMove] = useState<string | null>(null);
  const [predictionAnswer, setPredictionAnswer] = useState<{ id: string; answer: string } | null>(null);
  const [lessonsOpen, setLessonsOpen] = useState(false);
  const [dismissedCoach, setDismissedCoach] = useState<string | null>(null);
  const [replay, setReplay] = useState<string | null>(null);
  const [status, setStatus] = useState<BoardStatus>({ busy: true, reviewOpen: false, targeting: false });
  const [snapshot, setSnapshot] = useState<ReturnType<PracticeSession["getSnapshot"]> | null>(null);
  const guidance = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const speech = useRef<SpeechSynthesisUtterance | null>(null);
  const update = useCallback((event: LearningEvent) => {
    const next = lessonReducer(progressRef.current, event);
    progressRef.current = next; setProgress(next);
  }, []);
  useEffect(() => {
    // Hydration reads browser-only state once; this is an external storage synchronization.
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      let raw: string | null = null;
      try { raw = localStorage.getItem(KEY); } catch { setStorageError("This browser cannot save practice. You can keep playing; reloading will lose your progress."); }

      if (raw) {
        const saved: Saved = JSON.parse(raw);
        if (saved.version !== CURRICULUM_VERSION || !validProgress(saved.progress) || !(saved.intro === null || Number.isInteger(saved.intro) && saved.intro >= 0 && saved.intro < 5) || typeof saved.hints !== "boolean" || typeof saved.handoff !== "boolean") throw new Error("Unsupported saved lesson");
        const restored = restorePracticeSession(saved.session);
        if (saved.progress.revision !== restored.getSnapshot().game.revision && !(saved.progress.revision === -1 && restored.getSnapshot().game.revision === 0)) throw new Error("Lesson and match do not agree");
        progressRef.current = saved.progress; setProgress(saved.progress); setIntro(saved.intro); setHints(saved.hints); setHandoff(saved.handoff); setSnapshot(restored.getSnapshot()); setSession(restored);
      } else { const next = createPracticeSession(); setSnapshot(next.getSnapshot()); setSession(next); }
    } catch {
      setStorageError("Your saved practice could not be restored. Restart practice to keep the lesson and match together."); setRecovery(true);
    }
    return () => { if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel(); };
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  useLayoutEffect(() => session?.subscribe(transition => {
    update({ type: "transition", ...transition }); setSnapshot(transition.after);
  }), [session, update]);
  useEffect(() => {
    if (!session || recovery) return;
    try { localStorage.setItem(KEY, JSON.stringify({ version: CURRICULUM_VERSION, session: session.serialize(), progress: progressRef.current, intro, hints, handoff } satisfies Saved)); }
    // Storage refusal must be visible while allowing the current session to continue.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    catch { setStorageError("This browser cannot save practice. You can keep playing; reloading will lose your progress."); }
  }, [session, snapshot, progress, intro, hints, handoff, recovery]);
  useEffect(() => { if (intro !== null) heading.current?.focus(); if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel(); }, [intro]);
  useEffect(() => {
    if (intro !== null || !guidance.current || !host.current) return;
    const element = guidance.current;
    const updateSize = () => host.current?.style.setProperty("--tutorial-reserve", `${element.getBoundingClientRect().height}px`);
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [intro, session]);
  const onBoardStatus = useCallback((next: BoardStatus) => setStatus(old => old.busy === next.busy && old.reviewOpen === next.reviewOpen && old.targeting === next.targeting ? old : next), []);
  const restart = () => {
    if (!window.confirm("Restart this practice match and its lesson progress?")) return;
    const next = createPracticeSession(); const fresh = initialProgress(); progressRef.current = fresh; setProgress(fresh); setSession(next); setSnapshot(next.getSnapshot()); setIntro(0); setHandoff(false); setHints(true); setRecovery(false); setStorageError(null); setReplay(null); setDismissedCoach(null); setGeneration(g => g + 1); setNextMove(null);
  };
  const lesson = LESSONS.find(l => l.id === replay) ?? currentLesson(progress, snapshot ?? undefined);
  const opening = LESSONS.filter(l => l.id.startsWith("intro."));
  const lessonCopy = lesson.id === "opp.tie" ? (progress.outcome ?? "Compare the final totals after combos. Equal power counts as enough for the attacker.")
    : lesson.id === "opp.attack-predict" ? "The opponent is attacking! Before the battle finishes, predict: will the attack deal damage, or will it be stopped?"
    : lesson.id === "t1.affordability" ? snapshot ? affordabilityPrompt(snapshot).question : lesson.copy
    : lesson.id === "t1.play" ? lesson.copy.split(" After payment resolves:")[0] : lesson.copy;
  const spokenCoach = snapshot ? compactCoach(lesson.id, snapshot) : null;
  const text = intro === null ? replay ? lesson.copy : `${spokenCoach?.instruction ?? ""} ${spokenCoach?.concept ?? ""}` : opening[intro].copy;
  const read = () => {
    if (typeof speechSynthesis === "undefined") return;
    speechSynthesis.cancel(); speech.current = new SpeechSynthesisUtterance(text); speechSynthesis.speak(speech.current);
  };
  const readControls = <div className={styles.controls}><button type="button" onClick={read}>Read aloud</button><button type="button" onClick={() => { if (typeof speechSynthesis !== "undefined") { if (speechSynthesis.paused) speechSynthesis.resume(); else speechSynthesis.pause(); } }}>Pause / resume</button><button type="button" onClick={() => { if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel(); }}>Stop reading</button></div>;
  if (recovery) return <section className={styles.notice} role="alert"><h1>Resume practice</h1><p>{storageError}</p><button onClick={restart}>Restart practice</button><Link href="/arena">Return to Arena</Link></section>;
  if (!session || !snapshot) return <p role="status">Preparing your practice match…</p>;
  const coach = replay ? { instruction: lesson.copy, concept: "Replay: use Return to current lesson for guidance on this board." } : compactCoach(lesson.id, snapshot);
  const safeHandoff = intro === null && !handoff && handoffReady(progress) && !snapshot.view.battle && snapshot.waiting === "you" && snapshot.view.prompt.kind === "main" && !status.busy && !status.reviewOpen;
  const prediction = lesson.id === "t1.affordability" || lesson.id === "opp.attack-predict" || lesson.id === "changed-board.predict";

  const answer = predictionAnswer?.id === lesson.id ? predictionAnswer.answer : null;
  const focus = !hints || intro !== null || status.reviewOpen ? "none" : lesson.id.includes("charge") || lesson.id.includes("play") || lesson.id.includes("combo") ? "hand" : lesson.id.includes("attack") ? "attack" : "decision";
  return <div ref={host} className={styles.tutorial} data-tutorial-focus={focus}>
    {storageError && <p role="status" className={styles.notice}>{storageError}</p>}
    {intro !== null ? <section className={styles.intro} aria-labelledby="tutorial-heading">
      <div className={styles.introArt}><AnnouncerPortrait pose={intro === 4 ? "celebrate" : intro === 2 ? "thinking" : intro === 0 ? "welcome" : "explain"} size="large" /></div>
      <div className={styles.dialogue}><p className={styles.eyebrow}>Goku vs Frieza · BT1 · {intro + 1} / 5</p><h1 id="tutorial-heading" ref={heading} tabIndex={-1}>{["Welcome to the tournament!", "Meet your board", "Three different numbers", "Ready your energy", "You make the choices"][intro]}</h1><p className={styles.copy}>{text}</p>
      <details><summary>Why?</summary><p>{opening[intro].why}</p></details>
      <div className={styles.controls}><button disabled={intro === 0} onClick={() => setIntro(intro - 1)}>Back</button><button onClick={() => { update({ type: "acknowledge", id: opening[intro].id }); setIntro(intro === 4 ? null : intro + 1); }}>{intro === 4 ? "Let’s play" : "Next"}</button><button onClick={() => { opening.slice(intro).forEach(l => update({ type: "skip", id: l.id })); setIntro(null); }}>Skip opening</button><Link href="/arena">Exit practice</Link></div><details><summary>Optional read-aloud</summary>{readControls}</details></div>
    </section> : <>
      <div ref={guidance}>
      <div className={styles.toolbar}><div className={styles.controls}><button aria-pressed={hints} onClick={() => { setHints(!hints); setDismissedCoach(null); }}>{hints ? "Hints on · turn off" : "Restore hints"}</button><details className={styles.practiceMenu}><summary>Goku vs Frieza · BT1</summary><button aria-expanded={lessonsOpen} onClick={() => setLessonsOpen(!lessonsOpen)}>Lessons</button><button onClick={restart}>Restart practice</button><Link href="/arena">Exit practice</Link><details className={styles.evidence}><summary>What changed in this match?</summary><p>{progress.payment ?? "No confirmed play payment yet."}</p><p>{progress.outcome ?? "No completed battle yet."}</p><p>Demonstrated: {progress.completed.filter(id => !id.startsWith("intro.")).map(id => TITLES[id] ?? "Welcome").join(", ") || "Your next legal choice is on the board."}</p></details></details></div></div>
      {lessonsOpen && <section className={styles.lessonList} aria-label="Replay lessons"><button onClick={() => { setIntro(0); setLessonsOpen(false); }}>Replay welcome</button>{LESSONS.filter(l => !l.id.startsWith("intro.")).map(l => <button key={l.id} onClick={() => { setReplay(l.id); setDismissedCoach(null); setHints(true); setWhy(false); setLessonsOpen(false); }}>{TITLES[l.id] ?? "Welcome"} {progress.completed.includes(l.id) ? "· demonstrated" : progress.skipped.includes(l.id) ? "· skipped" : ""}</button>)}</section>}
      {safeHandoff ? <section className={styles.coach} aria-label="Choose guidance"><AnnouncerPortrait pose="celebrate" /><div><h2>Great battle! What would you do next?</h2><p>Choose a possible next move before seeing a hint. This prediction spends no action.</p>{!nextMove && <div className={styles.controls}>{snapshot.legal.filter(l => l.action.player === snapshot.view.you.player && l.action.type !== "concede").slice(0, 4).map((option, i) => <button key={i} onClick={() => { setNextMove(option.label); update({ type: "prediction", id: "changed-board.predict", answer: option.label }); }}>{option.label}</button>)}<button onClick={() => { setNextMove("Skipped"); update({ type: "prediction", id: "changed-board.predict", answer: "Skipped" }); }}>Skip question</button></div>}{nextMove && <><p>Your prediction: {nextMove}. Continue this same match with hints, or try your own choices. {progress.skipped.length > 0 ? `${progress.skipped.length} explanations or questions were skipped; you can replay them in Lessons.` : "You can replay explanations in Lessons anytime."}</p><div className={styles.controls}>{["Keep hints", "Play without guidance"].map((label, i) => <button key={label} onClick={() => { setHints(i === 0); setHandoff(true); }}>{label}</button>)}<button onClick={() => { setReplay("t2.resolve"); setHandoff(true); }}>Repeat explanation</button></div></>}</div></section> : hints && dismissedCoach !== `${lesson.id}:${snapshot.game.revision}` && <section className={styles.coach} aria-label="Announcer coach"><AnnouncerPortrait pose={prediction ? "thinking" : "explain"} /><div><p className={styles.eyebrow}>{replay ? "Replay · " : ""}World Tournament Announcer</p><h2>{TITLES[lesson.id]}</h2><p className={styles.pointer}>{coach.instruction}</p><p className={styles.concept}>{coach.concept}</p><details key={lesson.id} className={styles.explanation}><summary>Explain</summary><div className={styles.explanationBody}><p>{lessonCopy}</p><p className={styles.anchor}>{BADGE_GLOSSARY}</p><p className={styles.anchor}>Look at the {lesson.id.includes("charge") ? "hand and energy area" : lesson.id.includes("play") ? "card review and payment" : lesson.id.includes("attack") ? "attacker, legal targets and confirmation" : lesson.id.includes("combo") || lesson.id.includes("defend") || lesson.id.includes("tie") ? "battle totals and response controls" : "turn indicator and action controls"}.</p>{progress.payment && lesson.id === "t1.play" && <p>{progress.payment}</p>}{progress.outcome && ["opp.tie", "t2.resolve"].includes(lesson.id) && <p>{progress.outcome}</p>}
      {prediction && <div className={styles.controls}>{(lesson.id === "opp.attack-predict" ? ["Attack succeeds", "Attack is stopped", "Skip question"] : lesson.id === "changed-board.predict" ? ["Plan my own next move", "Skip question"] : ["Yes", "No", "Skip question"]).map(value => <button key={value} onClick={() => { if (value === "Skip question") update({ type: "prediction", id: lesson.id, answer: value }); else setPredictionAnswer({ id: lesson.id, answer: value }); }}>{value}</button>)}{answer && <><button onClick={() => update({ type: "prediction", id: lesson.id, answer })}>Continue</button><button onClick={() => setPredictionAnswer(null)}>Try again</button><p role="status">{lesson.id === "t1.affordability" ? affordabilityPrompt(snapshot).feedback : "Your answer spends no card or action. Compare the final power totals on the board; equal power favors the attacker."}</p></>}</div>}
      <div className={styles.controls}><button aria-expanded={why} onClick={() => setWhy(!why)}>Why?</button><button onClick={() => { update({ type: "skip", id: lesson.id }); setDismissedCoach(`${lesson.id}:${snapshot.game.revision}`); setReplay(null); }}>Skip explanation</button>{["t1.first-turn", "wrapup", "classic.awaken", "classic.evolve"].includes(lesson.id) && <button onClick={() => update({ type: "acknowledge", id: lesson.id })}>Understood</button>}{replay && <button onClick={() => setReplay(null)}>Return to current lesson</button>}</div>{why && <p>{lesson.why}</p>}<details><summary>Need another way?</summary><p>{lesson.recovery}</p><p>Touch: tap a card and read its review before confirming. Mouse: use the board’s gestures or click to inspect. Keyboard: Tab to a card or action, then Enter. Legal choices stay on the board.</p></details></div></details></div></section>}

      </div>
      <ArenaStage key={generation} session={session} snapshot={snapshot} skin={skin} staging={staging} lighting={lighting} onTutorialState={onBoardStatus} menu={<><button className="tap" onClick={() => { setHints(!hints); setDismissedCoach(null); }}>{hints ? "Turn practice hints off" : "Restore practice hints"}</button><Link href="/arena">Exit practice</Link></>} />
      {snapshot.view.over && <section className={styles.notice}><h2>Practice match finished</h2><p>{snapshot.view.over.winner === snapshot.view.you.player ? "You won this practice match." : "This practice match has ended."} This match used real BT1 decks and the normal eight starting Life.</p><button onClick={restart}>Replay practice</button><Link href="/arena">Return to Arena</Link></section>}
    </>}
  </div>;
}
