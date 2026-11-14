import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { activeRules, getImage, readFile, readImage, rebuildRuleCard, toImage } from "@/lib/evidence";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * PATCH { action: "confirm", text? }  the trader confirms Edge's reading, or
 *                                     corrects it (text) and confirms (PR-EV-3)
 *       { action: "reread" }           ask Edge to read the image again
 *       { polarity?, note? }           change the label or note: Edge reads it
 *                                     again and the trader re-confirms
 */
export async function PATCH(req: Request, { params }: Params) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const img = await getImage(id, user.id);
  if (!img || !["uploaded", "interpreted", "confirmed"].includes(img.status)) {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    text?: string;
    polarity?: string;
    note?: string;
  };

  if (body.action === "confirm") {
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 1000) : "";
    const corrected = Boolean(text) && text !== img.interpretation_text;
    await db.run(
      `UPDATE evidence_images SET status = 'confirmed', interpretation_confirmed_at = now(),
         interpretation_text = COALESCE(?, interpretation_text), corrected = ? WHERE id = ? AND user_id = ?`,
      corrected ? text : null,
      corrected ? true : img.corrected,
      id,
      user.id
    );
    await rebuildRuleCard(img.edge_id, img.item_key);
    return NextResponse.json({ image: toImage((await getImage(id, user.id))!) });
  }

  const polarity = body.polarity === "valid" || body.polarity === "invalid" ? body.polarity : img.polarity;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) || null : img.trader_note;
  if (body.action !== "reread" && polarity === img.polarity && note === img.trader_note) {
    return NextResponse.json({ image: toImage(img) });
  }

  const rule = (await activeRules(img.edge_id)).find((r) => r.item_key === img.item_key);
  if (!rule) return NextResponse.json({ error: "That rule is no longer in your active checklist." }, { status: 409 });
  let reading;
  try {
    reading = await readImage({ userId: user.id, rule, polarity, note, mime: img.mime_type, data: await readFile(img.object_key) });
  } catch (err) {
    console.error("[evidence] re-read failed:", err);
    return NextResponse.json({ error: "Edge couldn't read the image just now. Try again in a moment." }, { status: 502 });
  }
  // A changed image or note needs the trader's confirmation again (REQ-LLM-4).
  await db.run(
    `UPDATE evidence_images SET polarity = ?, trader_note = ?, status = 'interpreted',
       interpretation_text = ?, interpretation_json = ?, interpretation_confirmed_at = NULL, corrected = false
     WHERE id = ? AND user_id = ?`,
    polarity,
    note,
    [reading.reading, reading.why].filter(Boolean).join(" "),
    reading,
    id,
    user.id
  );
  await rebuildRuleCard(img.edge_id, img.item_key);
  return NextResponse.json({ image: toImage((await getImage(id, user.id))!) });
}

/**
 * DELETE -> take the image out of the rule ("don't use this image", EC-V8).
 * It is archived, not destroyed: past decisions keep their snapshot (EC-V9).
 */
export async function DELETE(_req: Request, { params }: Params) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const img = await getImage(id, user.id);
  if (!img) return NextResponse.json({ error: "Image not found." }, { status: 404 });
  await db.run(
    "UPDATE evidence_images SET status = 'archived', archived_at = now() WHERE id = ? AND user_id = ?",
    id,
    user.id
  );
  await rebuildRuleCard(img.edge_id, img.item_key);
  return NextResponse.json({ ok: true });
}
