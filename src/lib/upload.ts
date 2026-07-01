import { upload } from "@vercel/blob/client";

// Client-side file upload to Vercel Blob (free tier). Browser uploads directly to
// Blob storage via a short-lived token minted by /api/blob/upload — so large files
// (videos) don't hit the serverless body limit. Returns the public URL.
export async function uploadToBlob(file: File | Blob, folder: string, filename?: string): Promise<string> {
  const name = filename || (file as File).name || "file";
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const pathname = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
  const blob = await upload(pathname, file, {
    access: "public",
    handleUploadUrl: "/api/blob/upload",
  });
  return blob.url;
}
