/**
 * Supabase clients (server only).
 *
 * - authClient(): signs traders up and in with Supabase Auth, keeping the
 *   session in cookies (@supabase/ssr). Uses the public anon key.
 * - storage(): private file storage for evidence images and chart frames.
 *   Uses the service role key, which must never reach the browser.
 */
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  return url;
}

export function anonKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set");
  return key;
}

/** Auth client bound to this request's cookies (route handlers and server code). */
export async function authClient(): Promise<SupabaseClient> {
  const store = await cookies();
  return createServerClient(supabaseUrl(), anonKey(), {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(toSet) {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only; the
          // proxy refreshes the session on the next request instead.
        }
      },
    },
  });
}

declare global {
  var __edgeAdmin: SupabaseClient | undefined;
}

function admin(): SupabaseClient {
  if (!globalThis.__edgeAdmin) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
    globalThis.__edgeAdmin = createClient(supabaseUrl(), key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return globalThis.__edgeAdmin;
}

/** Private storage buckets created by supabase/migrations/0001_core_loop.sql. */
export type Bucket = "evidence" | "frames";

export async function putObject(bucket: Bucket, key: string, data: Buffer, contentType: string): Promise<void> {
  const { error } = await admin().storage.from(bucket).upload(key, data, { contentType, upsert: false });
  if (error) throw new Error(`storage upload failed (${bucket}/${key}): ${error.message}`);
}

export async function getObject(bucket: Bucket, key: string): Promise<Buffer> {
  const { data, error } = await admin().storage.from(bucket).download(key);
  if (error || !data) throw new Error(`storage download failed (${bucket}/${key}): ${error?.message ?? "no data"}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function removeObject(bucket: Bucket, key: string): Promise<void> {
  await admin().storage.from(bucket).remove([key]);
}
