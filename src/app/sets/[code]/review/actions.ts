"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { reviewSet } from "@/lib/ai/deck";

export async function reviewSetForm(formData: FormData) {
  const code = String(formData.get("code") ?? "");
  await reviewSet(db, code);
  revalidatePath(`/sets/${code}/review`);
}
