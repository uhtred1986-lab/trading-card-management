import { requireSignedInPage } from "@/lib/auth";
import { Tutorial } from "@/components/arena/tutorial/Tutorial";

export default async function TutorialPage() {
  await requireSignedInPage();
  return <Tutorial />;
}
