import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";


export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const rows = db
    .prepare(
      `SELECT e.id, e.name, e.description, e.active_version_id, e.created_at, e.updated_at,
              av.version_number AS active_version,
              (SELECT COUNT(*) FROM checklist_items ci JOIN edge_versions ev ON ci.version_id = ev.id
                WHERE ev.edge_id = e.id AND ev.status = 'approved') AS approved_items,
              (SELECT COUNT(*) FROM edge_versions ev2 WHERE ev2.edge_id = e.id) AS versions
       FROM edges e
       LEFT JOIN edge_versions av ON av.id = e.active_version_id
       WHERE e.user_id = ?
       ORDER BY e.updated_at DESC`
    )
    .all(user.id);
  return NextResponse.json({ edges: rows });
}
