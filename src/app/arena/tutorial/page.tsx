import { cookies } from "next/headers";
import { requireSignedInPage } from "@/lib/auth";
import { Tutorial } from "@/components/arena/tutorial/Tutorial";
import { LIGHTING_COOKIE, lightingFrom } from "@/lib/arena/lighting";
import { SKIN_COOKIE, skinFrom } from "@/lib/arena/skin";
import { STAGING_COOKIE, stagingFrom } from "@/lib/arena/staging";

export const dynamic = "force-dynamic";

export default async function TutorialPage({ searchParams }: { searchParams: Promise<{ skin?: string; staging?: string }> }) {
  await requireSignedInPage();
  const asked = await searchParams;
  const jar = await cookies();
  return <Tutorial
    skin={skinFrom(asked.skin ?? jar.get(SKIN_COOKIE)?.value)}
    staging={stagingFrom(asked.staging ?? jar.get(STAGING_COOKIE)?.value)}
    lighting={lightingFrom(jar.get(LIGHTING_COOKIE)?.value)}
  />;
}
