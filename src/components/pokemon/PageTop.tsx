/** The title row of a Pokémon screen: white on the painted route, with a small pill beside it. */
export function PageTop({ title, sub }: { title: string; sub?: React.ReactNode }) {
  return (
    <div className="pk-top">
      <h1>{title}</h1>
      {sub ? <span className="pk-pill">{sub}</span> : null}
    </div>
  );
}
