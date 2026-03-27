/**
 * Thinklet API client
 * All calls go to the Thinklet backend (Next.js / FastAPI).
 */

const API_URL = process.env.THINKLET_API_URL ?? "https://api.thinklet.io";
const API_KEY  = process.env.THINKLET_API_KEY  ?? "";
const BASE_URL = process.env.THINKLET_BASE_URL ?? "https://thinklet.io";

function headers() {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
  };
}

// ─── Types ─────────────────────────────────────────────────────────────────

export type Visibility = "public" | "unlisted" | "private";

export interface ThinkletMeta {
  id:          string;
  title:       string;
  description: string;
  tags:        string[];
  url:         string;
  embedUrl:    string;
  visibility:  Visibility;
  createdAt:   string;
  author?:     string;
  remixCount?: number;
  originalUrl?: string; // set on remixes — points to the source Thinklet
}

export interface PublishPayload {
  code:        string;
  title:       string;
  description: string;
  tags?:       string[];
  visibility?: Visibility;
}

export interface RemixPayload {
  originalId:  string;
  changes:     string;
  title:       string;
  description: string;
  visibility?: Visibility;
}

type ApiRecord = {
  id:           string;
  title:        string;
  description:  string;
  tags?:        string[];
  url?:         string;
  embed_url?:   string;
  embedUrl?:    string;
  visibility?:  string;
  created_at?:  string;
  createdAt?:   string;
  author?:      string;
  remix_count?: number;
  remixCount?:  number;
  original_url?: string;
  originalUrl?:  string;
};

function normalise(data: ApiRecord): ThinkletMeta {
  return {
    id:          data.id,
    title:       data.title,
    description: data.description,
    tags:        data.tags ?? [],
    url:         data.url ?? `${BASE_URL}/t/${data.id}`,
    embedUrl:    data.embed_url ?? data.embedUrl ?? `${BASE_URL}/embed/${data.id}`,
    visibility:  (data.visibility as Visibility) ?? "public",
    createdAt:   data.created_at ?? data.createdAt ?? new Date().toISOString(),
    author:      data.author,
    remixCount:  data.remix_count ?? data.remixCount,
    originalUrl: data.original_url ?? data.originalUrl,
  };
}

// ─── publish_thinklet ──────────────────────────────────────────────────────

export async function publishThinklet(payload: PublishPayload): Promise<ThinkletMeta> {
  const res = await fetch(`${API_URL}/api/v1/thinklets`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      code:        payload.code,
      title:       payload.title,
      description: payload.description,
      tags:        payload.tags ?? [],
      visibility:  payload.visibility ?? "public",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Thinklet publish failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as ApiRecord;
  return normalise(data);
}

// ─── remix_thinklet ────────────────────────────────────────────────────────

export async function remixThinklet(payload: RemixPayload): Promise<ThinkletMeta> {
  const res = await fetch(`${API_URL}/api/v1/thinklets/${payload.originalId}/remix`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      changes:     payload.changes,
      title:       payload.title,
      description: payload.description,
      visibility:  payload.visibility ?? "public",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Thinklet remix failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as ApiRecord;
  return normalise(data);
}

// ─── search_thinklets ──────────────────────────────────────────────────────

export async function searchThinklets(query: string, limit = 5): Promise<ThinkletMeta[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await fetch(`${API_URL}/api/v1/thinklets/search?${params}`, {
    headers: headers(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Thinklet search failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as { results?: ApiRecord[] } | ApiRecord[];
  const records = Array.isArray(data) ? data : (data.results ?? []);
  return records.map(normalise);
}

// ─── get_thinklet ──────────────────────────────────────────────────────────

export async function getThinklet(id: string): Promise<ThinkletMeta> {
  const res = await fetch(`${API_URL}/api/v1/thinklets/${id}`, {
    headers: headers(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Thinklet fetch failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as ApiRecord;
  return normalise(data);
}
