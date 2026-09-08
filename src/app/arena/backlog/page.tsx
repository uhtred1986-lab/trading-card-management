import { permanentRedirect } from "next/navigation";

/**
 * The card-text backlog is the Patterns tab now: the same wordings, grouped
 * beside the rules they are about rather than in a table of their own. Kept
 * as a redirect because the link is in the arena's own pages, in the
 * glossary, and in the owner's browser history.
 */
export default function BacklogPage() {
  permanentRedirect("/arena/rules/patterns?half=open");
}
