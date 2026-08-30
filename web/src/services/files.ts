import { decodeDocument, encodeDocument } from "../core/codec";
import type { AppSnapshot, NestiDocument } from "../core/types";

export async function readPlan(file: File): Promise<NestiDocument> {
  if (file.size > 5 * 1024 * 1024) throw new Error("This file is larger than the 5 MB import limit.");
  return decodeDocument(await file.text());
}

export function downloadPlan(snapshot: AppSnapshot, selectedRoomId?: string): void {
  const source = encodeDocument(snapshot, selectedRoomId);
  const blob = new Blob([source], { type: "application/vnd.nesti+json" });
  const room = snapshot.rooms.find((item) => item.id === selectedRoomId);
  const rawName = room?.name ?? snapshot.settings.homeName ?? "nesti-plan";
  const filename = rawName.replace(/[^a-z0-9-_ ]/gi, "-").trim() || "nesti-plan";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}.nesti`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}
