import { createFileRoute } from "@tanstack/react-router";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

// Mints short-lived client-upload tokens for Vercel Blob. The browser's upload()
// posts here to authorize a direct-to-Blob upload.
export const Route = createFileRoute("/api/blob/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as HandleUploadBody;
        try {
          const json = await handleUpload({
            body,
            request,
            onBeforeGenerateToken: async () => ({
              allowedContentTypes: ["image/*", "video/*", "application/pdf"],
              maximumSizeInBytes: 120 * 1024 * 1024,
              addRandomSuffix: false,
            }),
            onUploadCompleted: async () => { /* no-op */ },
          });
          return Response.json(json);
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 400 });
        }
      },
    },
  },
});
