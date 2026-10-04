"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { reviewSet } from "@/lib/ai/deck";
import { requireSl } from "@/lib/auth";

export async function reviewSetForm(formData: FormData) {
  await requireSl();
  const code = String(formData.get("code") ?? "");
  await reviewSet(db, code);
  revalidatePath(`/sets/${code}/review`);
}
