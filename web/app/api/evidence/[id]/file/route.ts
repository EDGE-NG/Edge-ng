import { getUser } from "@/lib/auth";
import { getImage, readFile } from "@/lib/evidence";

/** GET -> the image bytes, only to the trader who owns it. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return new Response("Not authenticated", { status: 401 });
  const { id } = await params;
  const img = await getImage(id, user.id);
  if (!img) return new Response("Not found", { status: 404 });
  try {
    const data = await readFile(img.object_key);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": img.mime_type,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
