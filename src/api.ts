/**
 * Thinklet API client — aligned with the real backend MCP endpoints.
 *
 * All calls go to /mcp/thinklets (API-key auth), with API_URL optionally
 * including an upstream prefix (e.g. https://api.example.com/api/v1).
 */

const API_URL = process.env.THINKLET_API_URL ?? "https://api.thinklet.io";
const API_KEY = process.env.THINKLET_API_KEY ?? "";
const CONTENT_BASE_URL =
  process.env.THINKLET_CONTENT_URL ?? "https://content.thinklet.io";
const APP_BASE_URL = (
  process.env.THINKLET_APP_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");
const MCP_BASE = `${API_URL}/mcp`;

function headers() {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
  };
}

// ─── Types ─────────────────────────────────────────────────────────────────

export type Visibility = "public" | "private";

export interface ThinkletMeta {
  id: string;
  title: string;
  description: string;
  tags: string[];
  visibility: Visibility;
  createdAt: string;
  platformUrl?: string;
  thumbnailUrl?: string;
  publicationId?: string;
  score?: number;
}

export interface AccessData {
  signedUrl: string;
  contentApiToken: string;
  contentId?: string;
  expiresIn: number;
}

interface ApiRecord {
  id: string;
  title: string;
  description: string;
  tags?: string[];
  visibility?: string;
  createdAt?: string;
  created_at?: string;
  platformUrl?: string;
  platform_url?: string;
  thumbnailUrl?: string;
  publicationId?: string;
  publication_id?: string;
  score?: number;
}

function normalise(data: ApiRecord): ThinkletMeta {
  return {
    id: data.id,
    title: data.title,
    description: data.description,
    tags: data.tags ?? [],
    visibility: (data.visibility as Visibility) ?? "private",
    createdAt: data.createdAt ?? data.created_at ?? new Date().toISOString(),
    platformUrl: data.platformUrl ?? data.platform_url,
    thumbnailUrl: data.thumbnailUrl,
    publicationId: data.publicationId ?? data.publication_id,
    score: data.score,
  };
}

/** Unwrap the backend's { data: ... } envelope. */
async function unwrap<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${label} failed (${res.status}): ${err}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  return ((json.data as T) ?? json) as T;
}

// ─── create / patch thinklet ───────────────────────────────────────────────

export interface CreatePayload {
  code: string;
  title: string;
  description: string;
  tags?: string[];
  integrations?: string[];
}

export interface PatchPayload {
  patchedFromId: string;
  code: string;
  title?: string;
  description?: string;
  tags?: string[];
  integrations?: string[];
}

export async function createThinklet(
  payload: CreatePayload
): Promise<ThinkletMeta> {
  const res = await fetch(`${MCP_BASE}/thinklets`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      code: payload.code,
      title: payload.title,
      description: payload.description,
      tags: payload.tags ?? [],
      integrations: payload.integrations ?? [],
    }),
  });
  return normalise(await unwrap<ApiRecord>(res, "Thinklet create"));
}

export async function patchThinklet(
  payload: PatchPayload
): Promise<ThinkletMeta> {
  const res = await fetch(`${MCP_BASE}/thinklets`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      code: payload.code,
      patchedFromId: payload.patchedFromId,
      title: payload.title,
      description: payload.description,
      tags: payload.tags,
      integrations: payload.integrations,
    }),
  });
  return normalise(await unwrap<ApiRecord>(res, "Thinklet patch"));
}

// ─── get thinklet ──────────────────────────────────────────────────────────

export async function getThinklet(id: string): Promise<ThinkletMeta> {
  const res = await fetch(`${MCP_BASE}/thinklets/${id}`, {
    headers: headers(),
  });
  return normalise(await unwrap<ApiRecord>(res, "Thinklet fetch"));
}

// ─── get code ──────────────────────────────────────────────────────────────

export async function getThinkletCode(id: string): Promise<string> {
  const res = await fetch(`${MCP_BASE}/thinklets/${id}/code`, {
    headers: headers(),
  });
  const data = await unwrap<{ code: string }>(res, "Thinklet code fetch");
  return data.code;
}

// ─── search ────────────────────────────────────────────────────────────────

export async function searchThinklets(
  query: string,
  limit = 5,
  includePrivate = true
): Promise<ThinkletMeta[]> {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    includePrivate: String(includePrivate),
  });
  const res = await fetch(
    `${MCP_BASE}/thinklets/search?${params}`,
    { headers: headers() }
  );
  const data = await unwrap<{ results?: ApiRecord[] } | ApiRecord[]>(
    res,
    "Thinklet search"
  );
  const records = Array.isArray(data) ? data : (data.results ?? []);
  return records.map(normalise);
}

// ─── access (signed URL + JWT for embed) ───────────────────────────────────

export async function fetchAccess(
  id: string,
  signal?: AbortSignal
): Promise<AccessData> {
  const res = await fetch(`${MCP_BASE}/thinklets/${id}/access`, {
    headers: headers(),
    signal,
  });
  return unwrap<AccessData>(res, "Thinklet access");
}

/** Build the embed URL for rendering inside Claude Desktop via MCP Apps. */
export function buildEmbedUrl(token: string): string {
  return `${CONTENT_BASE_URL}/embed/mcp?token=${encodeURIComponent(token)}`;
}

// ─── fix thinklet (patch code on existing) ─────────────────────────────────

export async function fixThinklet(
  id: string,
  code: string,
  title?: string,
  description?: string,
  tags?: string[],
  integrations?: string[]
): Promise<ThinkletMeta> {
  return patchThinklet({
    patchedFromId: id,
    code,
    title,
    description,
    tags,
    integrations,
  });
}

// ─── skill (editor prompt library, served per-mode) ───────────────────────

export type SkillMode = "create" | "edit";

type SkillCacheEntry = { text: string; fetchedAt: number };
const SKILL_TTL_MS = 60 * 60 * 1000; // 1h — editor prompt files change rarely
const skillCache: Record<SkillMode, SkillCacheEntry | undefined> = {
  create: undefined,
  edit: undefined,
};

/**
 * Fetch the editor's prompt library for the given mode. Falls back to throwing
 * so callers can decide whether to use their offline fallback text.
 */
export async function fetchSkill(mode: SkillMode): Promise<string> {
  const cached = skillCache[mode];
  if (cached && Date.now() - cached.fetchedAt < SKILL_TTL_MS) {
    return cached.text;
  }

  const res = await fetch(`${MCP_BASE}/skill?mode=${mode}`, {
    headers: headers(),
  });
  const data = await unwrap<{ skill: string; mode: string }>(res, "Skill fetch");
  const text = (data.skill ?? "").trim();
  if (!text) {
    throw new Error("empty skill payload");
  }
  skillCache[mode] = { text, fetchedAt: Date.now() };
  return text;
}

// ─── app URL ───────────────────────────────────────────────────────────────

/**
 * Build the user-facing app URL for a thinklet.
 * Uses backend-provided `platformUrl` when available, otherwise constructs
 * it client-side from THINKLET_APP_URL.
 * For public thinklets, the feed URL needs the publication ID, not the thinklet ID.
 */
export function buildAppUrl(
  id: string,
  visibility: Visibility,
  backendUrl?: string,
  publicationId?: string,
): string {
  if (backendUrl) return backendUrl;
  if (visibility === "public" && publicationId) return `${APP_BASE_URL}/feed?id=${publicationId}`;
  return `${APP_BASE_URL}/thinklets?id=${id}`;
}

// ─── set visibility ────────────────────────────────────────────────────────

export async function setVisibility(
  id: string,
  visibility: Visibility
): Promise<ThinkletMeta> {
  const res = await fetch(
    `${MCP_BASE}/thinklets/${id}/visibility`,
    {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ visibility }),
    }
  );
  return normalise(await unwrap<ApiRecord>(res, "Thinklet visibility"));
}
