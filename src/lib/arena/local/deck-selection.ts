/** Display preference only: saved matches can still resume a testing deck. */
export function selectableDecks<T extends { key: string; isTesting?: boolean }>(decks: readonly T[], showTesting = false): T[] {
  return decks.filter((deck) => showTesting || !deck.isTesting);
}

/** Hiding a selected test deck must also replace the submitted selection. */
export function selectedDeckKeys(decks: readonly { key: string }[], mine: string, theirs: string): { mine: string; theirs: string } {
  return {
    mine: decks.some((deck) => deck.key === mine) ? mine : decks[0]?.key ?? "",
    theirs: decks.some((deck) => deck.key === theirs) ? theirs : (decks[1] ?? decks[0])?.key ?? "",
  };
}
