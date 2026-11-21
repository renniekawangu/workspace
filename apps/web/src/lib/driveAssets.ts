import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { writeAudit } from "./audit";
import type { DriveFile } from "./drive";
import { db } from "./firebase";

export const ASSET_CATEGORIES = [
  "Image",
  "Video",
  "Document",
  "Logo",
  "Template",
  "Other",
] as const;

/** Adds a Drive file to the asset library. The Drive file id lets the app download it later. */
export async function addDriveAsset(
  uid: string,
  file: DriveFile,
  category: string,
) {
  const ref = await addDoc(collection(db, "contentAssets"), {
    name: file.name.slice(0, 160) || "Untitled file",
    category,
    platform: "",
    assetUrl:
      file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
    driveFileId: file.id,
    notes: "",
    createdAt: serverTimestamp(),
    createdBy: uid,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
  await writeAudit(uid, "digital.asset_link_added", "contentAsset", ref.id);
  return ref.id;
}
