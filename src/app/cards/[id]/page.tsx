import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { getCard } from "@/lib/catalog/queries";
import { CONDITIONS, LANGUAGES, lotsForCard } from "@/lib/collection/queries";
import { allocationForCards, decksReserving } from "@/lib/decks/reservations";
import { latestUsdEur } from "@/lib/pricing/fx";
import { pricesForPrints } from "@/lib/pricing/queries";
import { formatCents } from "@/lib/money";
import { CardFaces } from "@/components/CardFaces";
import { LotFinishToggle } from "@/components/LotFinishToggle";
import { ColorPill, RarityBadge, TypeBadge } from "@/components/ColorPill";
import { SkillText } from "@/components/SkillText";
import { MarketplacePanel } from "@/components/MarketplacePanel";
import { DeckPicker } from "@/components/DeckPicker";
import { deckOptions } from "@/lib/decks/add";
import { addLotForm, deleteLotForm } from "@/app/collection/actions";

export const dynamic = "force-dynamic";

export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const card = await getCard(db, id);
  if (!card) notFound();

  const printIds = card.prints.map((p) => p.id);
  const [prices, alloc, lots, reservedBy, usdEur, decks] = await Promise.all([
    pricesForPrints(db, printIds),
    allocationForCards(db, [id]),
    lotsForCard(db, id),
    decksReserving(db, id),
    latestUsdEur(db),
    deckOptions(db),
  ]);
  const a = alloc.get(id)!;
  const tcgUrl = (await db.query.tcgProducts.findFirst({ where: (p, { eq }) => eq(p.cardId, id), columns: { url: true } }))?.url ?? null;
  const eur = (usd: number | null) => (usd == null ? "—" : usdEur != null ? formatCents(Math.round(usd * usdEur), "EUR") : formatCents(usd, "USD"));
  const input = "tap w-full rounded-md border border-space-600 bg-space-900 px-2 py-1.5 text-sm text-space-100";

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(220px,300px)_1fr]">
      <div className="space-y-3">
        <CardFaces front={card.imageUrl} back={card.backImageUrl} name={card.name} backName={card.backName} priority sizes="(min-width: 768px) 300px, 90vw" />
        <div className="rounded-xl border border-space-700/70 bg-space-900/60 p-3 text-sm">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-space-300">Allocation</div>
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div>
              <dt className="text-xs text-space-300">Owned</dt>
              <dd className="text-xl font-semibold text-space-50">{a.owned}</dd>
            </div>
            <div>
              <dt className="text-xs text-space-300">Reserved</dt>
              <dd className="text-xl font-semibold text-ki-300">{a.reserved}</dd>
            </div>
            <div>
              <dt className="text-xs text-space-300">Available</dt>
              <dd className={`text-xl font-semibold ${a.available < 0 ? "text-loss" : "text-gain"}`}>{a.available}</dd>
            </div>
          </dl>
          {a.owned > 0 ? (
            <p className="mt-2 border-t border-space-700 pt-2 text-center text-xs text-space-300">
              {lots.reduce((n, l) => n + (l.finish === "foil" ? l.quantity : 0), 0)} <span className="text-amber-300">✦ foil</span> ·{" "}
              {lots.reduce((n, l) => n + (l.finish === "foil" ? 0 : l.quantity), 0)} non-foil
            </p>
          ) : null}
          {reservedBy.length ? (
            <ul className="mt-2 space-y-1 border-t border-space-700 pt-2 text-xs text-space-300">
              {reservedBy.map((d) => (
                <li key={d.id}>
                  <Link className="text-space-100 hover:text-ki-300" href={`/decks/${d.id}`}>
                    {d.name}
                  </Link>{" "}
                  reserves ×{d.quantity}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <div className="space-y-5">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-space-300">
            <span className="font-mono">{card.id}</span>
            <Link href={`/cards?set=${card.setCode}`} className="hover:text-ki-300">
              {card.set.name}
            </Link>
            <span className="rounded bg-space-800 px-1.5 py-px uppercase">{card.set.line}</span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-space-50">{card.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <TypeBadge type={card.cardType} />
            <RarityBadge code={card.rarityCode} />
            {card.colors.map((c) => (
              <ColorPill key={c} color={c} />
            ))}
            {card.isBanned ? <span className="rounded bg-dbs-red px-1.5 py-px text-[10px] font-bold uppercase text-white">Banned</span> : null}
            {card.isLimited ? <span className="rounded bg-dbs-yellow px-1.5 py-px text-[10px] font-bold uppercase text-space-950">Limited to {card.limitedTo}</span> : null}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <Stat label="Energy" value={card.energyCost ?? "—"} />
          <Stat label="Power" value={card.power?.toLocaleString() ?? "—"} />
          <Stat label="Combo" value={card.comboCost != null ? `${card.comboCost} / ${card.comboPower?.toLocaleString() ?? "—"}` : "—"} />
          <Stat label="Z-Energy" value={card.zEnergyCost ?? "—"} />
          <Stat label="Character" value={card.characters.join(", ") || "—"} />
          <Stat label="Traits" value={card.traits.join(", ") || "—"} />
          <Stat label="Era" value={card.eras.join(", ") || "—"} />
          <Stat label="Copy limit" value={card.limitedTo?.toString() ?? "—"} />
        </dl>

        {card.skill ? (
          <div className="rounded-xl border border-space-700/70 bg-space-900/60 p-3 text-sm leading-relaxed">
            <SkillText text={card.skill} />
          </div>
        ) : null}
        {card.backName ? (
          <div className="rounded-xl border border-space-700/70 bg-space-900/60 p-3 text-sm leading-relaxed">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="font-semibold text-space-50">{card.backName}</span>
              <span className="text-xs text-space-300">Awakened · {card.backPower?.toLocaleString() ?? "—"}</span>
            </div>
            {card.backSkill ? <SkillText text={card.backSkill} /> : null}
          </div>
        ) : null}

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-space-300">Prints & market price</h2>
          <div className="overflow-x-auto rounded-xl border border-space-700/70">
            <table className="w-full text-sm">
              <thead className="bg-space-900 text-left text-xs uppercase tracking-wide text-space-300">
                <tr>
                  <th className="px-3 py-2">Print</th>
                  <th className="px-3 py-2">Rarity</th>
                  <th className="px-3 py-2 text-right">Normal</th>
                  <th className="px-3 py-2 text-right">Foil</th>
                  <th className="px-3 py-2 text-right">As of</th>
                </tr>
              </thead>
              <tbody>
                {card.prints.map((p) => {
                  const pr = prices.get(p.id);
                  return (
                    <tr key={p.id} className="border-t border-space-800">
                      <td className="px-3 py-2">
                        <span className="font-medium text-space-50">{p.label}</span> <span className="font-mono text-xs text-space-300">{p.id}</span>
                      </td>
                      <td className="px-3 py-2 text-space-200">{p.rarity}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{eur(pr?.normalCents ?? null)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{eur(pr?.foilCents ?? null)}</td>
                      <td className="px-3 py-2 text-right text-xs text-space-300">{pr?.capturedOn ?? "no data"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-space-400">TCGplayer market price{usdEur ? ` converted at 1 USD = ${usdEur.toFixed(4)} EUR` : " in USD"}.</p>
        </section>

        <MarketplacePanel card={{ id: card.id, name: card.name }} tcgUrl={tcgUrl} />

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-space-300">In your collection</h2>
          {lots.length === 0 ? (
            <p className="text-sm text-space-300">You don&apos;t own this card yet.</p>
          ) : (
            <ul className="divide-y divide-space-800 rounded-xl border border-space-700/70">
              {lots.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <span className="font-semibold text-space-50">×{l.quantity}</span>
                  <span>{l.printLabel}</span>
                  <span className="rounded bg-space-800 px-1.5 text-xs">{l.condition}</span>
                  <LotFinishToggle lotId={l.id} foil={l.finish === "foil"} />
                  <span className="text-xs text-space-300">{l.language}</span>
                  {l.pricePaidCents != null ? <span className="text-xs text-space-300">paid {formatCents(l.pricePaidCents, l.currency as "EUR" | "USD")} each</span> : null}
                  {l.acquiredOn ? <span className="text-xs text-space-300">{l.acquiredOn}</span> : null}
                  {l.owner ? <span className="rounded bg-space-800 px-1.5 text-[10px] text-space-300">{l.owner}</span> : null}
                  {l.notes ? <span className="text-xs italic text-space-300">{l.notes}</span> : null}
                  <form action={deleteLotForm} className="ml-auto">
                    <input type="hidden" name="id" value={l.id} />
                    <button className="tap rounded px-2 py-1 text-xs text-space-300 hover:bg-space-800 hover:text-loss">Remove</button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <form action={addLotForm} className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-space-700/70 bg-space-900/50 p-3 sm:grid-cols-4">
            <label className="col-span-2 text-xs text-space-300">
              Print
              <select name="printId" className={input} defaultValue={card.prints[0]?.id}>
                {card.prints.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.id})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-space-300">
              Qty
              <input name="quantity" type="number" min={1} defaultValue={1} className={input} />
            </label>
            <label className="text-xs text-space-300">
              Condition
              <select name="condition" className={input} defaultValue="NM">
                {CONDITIONS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-space-300">
              Finish
              <select name="finish" className={input} defaultValue="normal">
                <option value="normal">Non-foil</option>
                <option value="foil">Foil</option>
              </select>
            </label>
            <label className="text-xs text-space-300">
              Language
              <select name="language" className={input} defaultValue="EN">
                {LANGUAGES.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-space-300">
              Paid each (€)
              <input name="pricePaid" inputMode="decimal" placeholder="1,50" className={input} />
            </label>
            <label className="text-xs text-space-300">
              Acquired
              <input name="acquiredOn" type="date" className={input} />
            </label>
            <label className="col-span-2 text-xs text-space-300 sm:col-span-3">
              Notes
              <input name="notes" className={input} placeholder="optional" />
            </label>
            <div className="col-span-2 sm:col-span-3">
              <DeckPicker decks={decks} compact />
            </div>
            <button className="tap self-end rounded-md bg-ki-500 px-3 py-1.5 text-sm font-semibold text-space-950 hover:bg-ki-400">Add to collection</button>
          </form>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-space-300">{label}</dt>
      <dd className="text-space-100">{value}</dd>
    </div>
  );
}
