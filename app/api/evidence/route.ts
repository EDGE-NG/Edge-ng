import { NextResponse } from "next/server";
import { getUser, tooManyAttempts } from "@/lib/auth";
import { db, now } from "@/lib/db";
import {
  MAX_BYTES,
  MAX_IMAGES_PER_RULE,
  MIN_HEIGHT,
  MIN_WIDTH,
  activeImages,
  activeRules,
  coverageOf,
  deleteFile,
  getImage,
  needsImages,
  newId,
  readImage,
  saveFile,
  sha256,
  sniffImage,
  stripMetadata,
  toImage,
} from "@/lib/evidence";

/**
 * GET -> the trader's approved checklists with each rule's evidence:
 * images, coverage, and whether the rule can be enforced at the gate
 * (PR-CL-5: a chart rule needs at least one confirmed image).
 */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const edges = db
    .prepare(
      `SELECT e.id, e.name, v.version_number,
              (SELECT c.id FROM chats c WHERE c.edge_id = e.id ORDER BY c.updated_at DESC LIMIT 1) AS chat_id
       FROM edges e JOIN edge_versions v ON v.id = e.active_version_id
       WHERE e.user_id = ? ORDER BY e.updated_at DESC`
    )
    .all(user.id) as Array<{ id: string; name: string; version_number: number; chat_id: string | null }>;

  const checklists = edges.map((e) => {
    const images = activeImages(e.id);
    const rules = activeRules(e.id).map((r) => {
      const imgs = images.filter((i) => i.item_key === r.item_key);
      const chart = needsImages(r);
      return {
        ...r,
        needsImages: chart,
        images: imgs,
        coverage: coverageOf(imgs),
        ready: !chart || imgs.some((i) => i.confirmed),
      };
    });
    return { edgeId: e.id, name: e.name, versionNumber: e.version_number, chatId: e.chat_id, rules };
  });
  return NextResponse.json({ checklists, limits: { maxPerRule: MAX_IMAGES_PER_RULE, maxBytes: MAX_BYTES } });
}

/**
 * POST multipart { edgeId, itemKey, polarity, note?, replaceId?, file }
 * -> checks the file, stores it without metadata, and asks Edge to read it
 * for that rule. The reading waits for the trader's confirmation (PR-EV-3).
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (tooManyAttempts(`evidence:${user.id}`, 60, 60 * 60_000)) {
    return NextResponse.json({ error: "That's a lot of uploads in an hour. Take a short break." }, { status: 429 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Upload not received." }, { status: 400 });
  const edgeId = String(form.get("edgeId") ?? "");
  const itemKey = String(form.get("itemKey") ?? "");
  const polarity = form.get("polarity");
  const note = String(form.get("note") ?? "").trim().slice(0, 1000) || null;
  const replaceId = String(form.get("replaceId") ?? "") || null;
  const file = form.get("file");

  if (polarity !== "valid" && polarity !== "invalid") {
    return NextResponse.json({ error: "Mark the image as a valid or an invalid example." }, { status: 400 });
  }
  const edge = db.prepare("SELECT id FROM edges WHERE id = ? AND user_id = ?").get(edgeId, user.id);
  if (!edge) return NextResponse.json({ error: "Checklist not found." }, { status: 404 });
  const rule = activeRules(edgeId).find((r) => r.item_key === itemKey);
  if (!rule) return NextResponse.json({ error: "That rule isn't in your active checklist." }, { status: 404 });

  const replacing = replaceId ? getImage(replaceId, user.id) : undefined;
  if (replaceId && (!replacing || replacing.item_key !== itemKey || replacing.edge_id !== edgeId)) {
    return NextResponse.json({ error: "The image you're replacing wasn't found." }, { status: 404 });
  }
  // EC-V2: a seventh image is blocked; replacing one of the six is fine.
  if (!replacing && activeImages(edgeId, itemKey).length >= MAX_IMAGES_PER_RULE) {
    return NextResponse.json(
      { error: `This rule already has ${MAX_IMAGES_PER_RULE} images, the most allowed. Replace one instead.`, code: "limit" },
      { status: 409 }
    );
  }

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Choose a chart image to upload." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "That image is over 10 MB. Export a smaller screenshot." }, { status: 413 });
  }
  const raw = Buffer.from(await file.arrayBuffer());
  const info = sniffImage(raw); // by content, never by file name (EC-V3)
  if (!info) {
    return NextResponse.json({ error: "That isn't a PNG, JPEG or WebP image." }, { status: 415 });
  }
  if (info.width < MIN_WIDTH || info.height < MIN_HEIGHT) {
    return NextResponse.json(
      { error: `That image is ${info.width}×${info.height}. Use at least ${MIN_WIDTH}×${MIN_HEIGHT} so the candles are readable.` },
      { status: 422 }
    );
  }
  const clean = stripMetadata(raw, info.mime);
  const hash = sha256(clean);
  const dupe = db
    .prepare(
      `SELECT id FROM evidence_images WHERE edge_id = ? AND item_key = ? AND sha256 = ?
       AND status IN ('uploaded','interpreted','confirmed')`
    )
    .get(edgeId, itemKey, hash);
  if (dupe) return NextResponse.json({ error: "You've already added this exact image to this rule." }, { status: 409 });

  // Edge reads the image first, so obvious non-charts are never stored (EC-V4).
  let reading;
  try {
    reading = await readImage({ userId: user.id, rule, polarity, note, mime: info.mime, data: clean });
  } catch (err) {
    console.error("[evidence] read failed:", err);
    return NextResponse.json(
      { error: "Edge couldn't read the image just now. Nothing was saved. Try again in a moment." },
      { status: 502 }
    );
  }
  if (!reading.is_chart) {
    return NextResponse.json(
      { error: reading.problem || "That doesn't look like a price chart. Upload a chart screenshot.", code: "not_chart" },
      { status: 422 }
    );
  }

  const id = newId();
  const objectKey = saveFile(user.id, id, info.mime, clean);
  const ts = now();
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO evidence_images (id, user_id, edge_id, item_key, polarity, status, object_key, mime_type, bytes,
         width, height, sha256, trader_note, interpretation_text, interpretation_json, supersedes_id, created_at)
       VALUES (?, ?, ?, ?, ?, 'interpreted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      user.id,
      edgeId,
      itemKey,
      polarity,
      objectKey,
      info.mime,
      clean.length,
      info.width,
      info.height,
      hash,
      note,
      [reading.reading, reading.why].filter(Boolean).join(" "),
      JSON.stringify(reading),
      replacing?.id ?? null,
      ts
    );
    if (replacing) {
      // PR-EV-6: the old image is kept (past decisions still point at it)
      db.prepare("UPDATE evidence_images SET status = 'replaced', archived_at = ? WHERE id = ?").run(ts, replacing.id);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    deleteFile(objectKey);
    throw err;
  }

  const row = getImage(id, user.id)!;
  return NextResponse.json({ image: toImage(row) }, { status: 201 });
}
