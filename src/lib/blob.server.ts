import { put } from "@vercel/blob";

// Server-side upload to Vercel Blob (for AI-generated images). Returns the public URL.
export async function putImageToBlob(buffer: Buffer, pathname: string, contentType = "image/png"): Promise<string> {
  const blob = await put(pathname, buffer, {
    access: "public",
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return blob.url;
}
