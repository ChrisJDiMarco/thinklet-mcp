/**
 * Thinklet API client.
 *
 * ApiClient is instantiated per-session (HTTP mode) or once at startup (stdio mode),
 * holding the Cognito `sub` of the authenticated user. Backend calls send a shared
 * service credential (MCP_SERVICE_KEY) plus the user's sub in X-Thinklet-User-Sub —
 * the MCP OAuth spec prohibits forwarding the user's JWT to upstream APIs.
 */

const API_URL = process.env.THINKLET_API_URL ?? "https://api.thinklet.io";
const CONTENT_BASE_URL =
  process.env.THINKLET_CONTENT_URL ?? "https://content.thinklet.io";
const APP_BASE_URL = (
  process.env.THINKLET_APP_URL ?? "https://app.thinklet.io"
).replace(/\/+$/, "");
const MCP_SERVICE_KEY = process.env.MCP_SERVICE_KEY ?? "";

// ─── Sentinel error ────────────────────────────────────────────────────────

export class AuthError extends Error {
  constructor() {
    super("missing_or_invalid_token");
    this.name = "AuthError";
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────

export type Visibility = "public" | "private";
export type SkillMode = "create" | "edit";

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

type SkillCacheEntry = { text: string; fetchedAt: number };
const SKILL_TTL_MS = 60 * 60 * 1000;

// ─── Client ────────────────────────────────────────────────────────────────

export class ApiClient {
  private readonly userSub: string;
  private readonly mcpBase: string;
  private readonly appBaseUrl: string;
  private readonly contentBaseUrl: string;
  private readonly skillCache: Record<SkillMode, SkillCacheEntry | undefined> =
    { create: undefined, edit: undefined };

  constructor(userSub: string) {
    this.userSub = userSub;
    this.mcpBase = `${API_URL}/mcp`;
    this.appBaseUrl = APP_BASE_URL;
    this.contentBaseUrl = CONTENT_BASE_URL;
  }

  private headers() {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (MCP_SERVICE_KEY) h["Authorization"] = `Bearer ${MCP_SERVICE_KEY}`;
    if (this.userSub) h["X-Thinklet-User-Sub"] = this.userSub;
    return h;
  }

  private normalise(data: ApiRecord): ThinkletMeta {
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

  private async unwrap<T>(res: Response, label: string): Promise<T> {
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new AuthError();
      const err = await res.text();
      throw new Error(`${label} failed (${res.status}): ${err}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    return ((json.data as T) ?? json) as T;
  }

  async createThinklet(payload: CreatePayload): Promise<ThinkletMeta> {
    const res = await fetch(`${this.mcpBase}/thinklets`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        code: payload.code,
        title: payload.title,
        description: payload.description,
        tags: payload.tags ?? [],
        integrations: payload.integrations ?? [],
      }),
    });
    return this.normalise(await this.unwrap<ApiRecord>(res, "Thinklet create"));
  }

  async patchThinklet(payload: PatchPayload): Promise<ThinkletMeta> {
    const res = await fetch(`${this.mcpBase}/thinklets`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        code: payload.code,
        patchedFromId: payload.patchedFromId,
        title: payload.title,
        description: payload.description,
        tags: payload.tags,
        integrations: payload.integrations,
      }),
    });
    return this.normalise(await this.unwrap<ApiRecord>(res, "Thinklet patch"));
  }

  async getThinklet(id: string): Promise<ThinkletMeta> {
    const res = await fetch(`${this.mcpBase}/thinklets/${id}`, {
      headers: this.headers(),
    });
    return this.normalise(await this.unwrap<ApiRecord>(res, "Thinklet fetch"));
  }

  async getThinkletCode(id: string): Promise<string> {
    const res = await fetch(`${this.mcpBase}/thinklets/${id}/code`, {
      headers: this.headers(),
    });
    const data = await this.unwrap<{ code: string }>(res, "Thinklet code fetch");
    return data.code;
  }

  async searchThinklets(
    query: string,
    limit = 5,
    includePrivate = true
  ): Promise<ThinkletMeta[]> {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
      includePrivate: String(includePrivate),
    });
    const res = await fetch(`${this.mcpBase}/thinklets/search?${params}`, {
      headers: this.headers(),
    });
    const data = await this.unwrap<
      { results?: ApiRecord[] } | ApiRecord[]
    >(res, "Thinklet search");
    const records = Array.isArray(data) ? data : (data.results ?? []);
    return records.map((r) => this.normalise(r));
  }

  async fetchAccess(id: string, signal?: AbortSignal): Promise<AccessData> {
    const res = await fetch(`${this.mcpBase}/thinklets/${id}/access`, {
      headers: this.headers(),
      signal,
    });
    return this.unwrap<AccessData>(res, "Thinklet access");
  }

  async fixThinklet(
    id: string,
    code: string,
    title?: string,
    description?: string,
    tags?: string[],
    integrations?: string[]
  ): Promise<ThinkletMeta> {
    return this.patchThinklet({ patchedFromId: id, code, title, description, tags, integrations });
  }

  async fetchSkill(mode: SkillMode): Promise<string> {
    const cached = this.skillCache[mode];
    if (cached && Date.now() - cached.fetchedAt < SKILL_TTL_MS) {
      return cached.text;
    }
    const res = await fetch(`${this.mcpBase}/skill?mode=${mode}`, {
      headers: this.headers(),
    });
    const data = await this.unwrap<{ skill: string; mode: string }>(
      res,
      "Skill fetch"
    );
    const text = (data.skill ?? "").trim();
    if (!text) throw new Error("empty skill payload");
    this.skillCache[mode] = { text, fetchedAt: Date.now() };
    return text;
  }

  async setVisibility(id: string, visibility: Visibility): Promise<ThinkletMeta> {
    const res = await fetch(`${this.mcpBase}/thinklets/${id}/visibility`, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify({ visibility }),
    });
    return this.normalise(
      await this.unwrap<ApiRecord>(res, "Thinklet visibility")
    );
  }

  buildAppUrl(
    id: string,
    visibility: Visibility,
    backendUrl?: string,
    publicationId?: string
  ): string {
    if (backendUrl) return backendUrl;
    if (visibility === "public" && publicationId)
      return `${this.appBaseUrl}/feed?id=${publicationId}`;
    return `${this.appBaseUrl}/thinklets?id=${id}`;
  }

  buildEmbedUrl(token: string): string {
    return `${this.contentBaseUrl}/embed/mcp?token=${encodeURIComponent(token)}`;
  }
}
