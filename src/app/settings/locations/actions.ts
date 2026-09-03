"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { createLocation, deleteLocation, updateLocation } from "@/lib/collection/locations";

export type LocationResult = { ok: true; message: string } | { ok: false; error: string };

function done(message: string): LocationResult {
  revalidatePath("/settings/locations");
  revalidatePath("/collection");
  return { ok: true, message };
}

export async function createLocationAction(name: string, note: string): Promise<LocationResult> {
  if (!name.trim()) return { ok: false, error: "Give the location a name." };
  const row = await createLocation(db, name, note);
  if (!row) return { ok: false, error: `There is already a location called ${name.trim()}.` };
  return done(`${row.name} added.`);
}

export async function renameLocationAction(id: number, name: string): Promise<LocationResult> {
  if (!name.trim()) return { ok: false, error: "A location needs a name." };
  await updateLocation(db, id, { name });
  return done("Renamed.");
}

export async function setLocationNoteAction(id: number, note: string): Promise<LocationResult> {
  await updateLocation(db, id, { note });
  return done("Saved.");
}

export async function archiveLocationAction(id: number, isArchived: boolean): Promise<LocationResult> {
  await updateLocation(db, id, { isArchived });
  return done(isArchived ? "Archived — it stays on the cards already filed there." : "Back in the pickers.");
}

export async function deleteLocationAction(id: number): Promise<LocationResult> {
  await deleteLocation(db, id);
  return done("Deleted. Cards kept there now show no location.");
}
