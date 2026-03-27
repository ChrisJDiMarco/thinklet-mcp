/**
 * Thinklet API client
 * All calls go to the Thinklet backend (Next.js / FastAPI).
 */

const API_URL = process.env.THINKLET_API_URL ?? "https://api.thinklet.io";
const API_KEY = process.env.THINKLET_API_KEY ?? "";
const BASE_URL = process.env.THINKLET_BASE_URL ?? "https://thinklet.io";

function headers() {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
  };
}

export interface ThinkletMeta {
  id: string;
  title: string;
  description: string;
  tags: string[];
  url: string;
  embedUrl: string;
  createdAt: string;
  author?: string;
}

export interface PublishPayload {
  code: string;
  title: string;
  description: string;
  tags?: string[];
}

type ApiRecord = {
  id: string;
  title: string;
  description: string;
  tags?: string[];
  url?: string;
  embedUrl?: string;
  createdAt?: string;
  author?: string;
};

function normalise(data: ApiRecord): ThinkletMeta {
  return {
    id: data.id,
    title: data.title,
    description: data.description,
    tags: data.tags ?? [],
    url: data.url ?? `${BASE_URL}/t/${data.id}`,
    embedUrl: data.embedUrl ?? `${BASE_URL}/embed/${data.id}`,
    createdAt: data.createdAt ?? new Date().toISOString(),
    author: data.author,
  };
}

/** Publish a new Thinklet. Returns its metadata including URL. */
export async function publishThinklet(payload: PublishPayload): Promise<ThinkletMeta> {
  const res = await fetch(`${API_URL}/api/v1/thinklets`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Thinklet publish failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as ApiRecord;
  return normalise(data);
}

/** Search published Thinklets by natural language query. */
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

/** Get a single Thinklet by ID. */
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
