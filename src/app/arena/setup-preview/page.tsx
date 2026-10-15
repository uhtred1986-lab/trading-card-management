import { notFound } from "next/navigation";
import { requireSlPage } from "@/lib/auth";
import { SetupPreview } from "./SetupPreview";
import { LeaderLibrary } from "@/components/LeaderLibrary";
import type { OwnedLeader } from "@/lib/leaders/queries";
import { readPack } from "@/components/arena/session/local-board";
import { buildMastersPack } from "../../../../scripts/build-arena-offline-pack.mts";
import { PageHeader } from "@/components/ui";

/** Fixture-only setup evidence, guarded like the board preview and absent in production. */
export default async function Page({searchParams}:{searchParams:Promise<{view?:string}>}) {
  await requireSlPage();
  if (process.env.NODE_ENV === "production") notFound();
  const {view}=await searchParams;
  if (view === "leaders") {
    const all: OwnedLeader[] = [0,1,2].map((i) => ({id:`SD${i+1}-01`,name:"Bardock, the Resolute Warrior with a long leader name",backName:"Bardock, Awakened",setCode:"SD1",setName:"Starter deck",game:"dbs",colors:["Red"],rarityCode:"L",imageUrl:null,backImageUrl:null,owned:1,decks:[{id:i+1,name:"Bardock’s Crew — early pressure and coordinated Saiyan attacks",description:"Aggressive red strategy with early pressure, efficient trades and a late coordinated attack.",isBuilt:i===0,game:"dbs",mainCount:50,status:"legal"}]}));
    return <LeaderLibrary all={all} aiEnabled={false} />;
  }
  // The audited pack has unresolved blockers. This display fixture does not create a match.
  const pack = view==="local" ? await buildMastersPack({runtimeRevision:"8280000000000000000000000000000000000000"}) : null;
  return <div className="ds-page space-y-4"><PageHeader title="Match setup preview" eyebrow="Arena · Design fixture" description="Preview the real setup controls with fixture data; no match is started." /><SetupPreview view={view} local={pack ? readPack({...pack,qualification:{playable:true,reasons:[]}}) : undefined} /></div>;
}
