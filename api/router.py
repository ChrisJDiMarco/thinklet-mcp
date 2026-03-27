"""
Thinklet API Router — FastAPI
=============================
Drop this into your existing FastAPI app:

    from api.thinklets import router as thinklets_router
    app.include_router(thinklets_router, prefix="/api/v1")

Then hit:
    POST /api/v1/thinklets          — publish a new Thinklet
    GET  /api/v1/thinklets/search   — search by query
    GET  /api/v1/thinklets/{id}     — get single Thinklet

You'll need to swap the stub storage below for your real DB (Supabase, Postgres, etc.)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from .models import ThinkletCreate, ThinkletResponse, ThinkletSearchResponse

router = APIRouter(tags=["thinklets"])

# ─── Config ──────────────────────────────────────────────────────────────────
# Update these to match your actual domain
THINKLET_BASE_URL = "https://thinklet.io"
THINKLET_EMBED_BASE = "https://thinklet.io/embed"


# ─── Storage stub ─────────────────────────────────────────────────────────────
# TODO: replace with your real database (Supabase, Postgres, etc.)
# The interface expected:
#   db.create_thinklet(id, title, description, code, tags, author) -> ThinkletRecord
#   db.get_thinklet(id) -> ThinkletRecord | None
#   db.search_thinklets(query, limit) -> list[ThinkletRecord]

def _build_response(record: dict) -> ThinkletResponse:
    """Convert a DB record dict to ThinkletResponse."""
    id_ = record["id"]
    return ThinkletResponse(
        id=id_,
        title=record["title"],
        description=record["description"],
        tags=record.get("tags", []),
        url=f"{THINKLET_BASE_URL}/t/{id_}",
        embed_url=f"{THINKLET_EMBED_BASE}/{id_}",
        created_at=record.get("created_at", datetime.now(timezone.utc)),
        author=record.get("author"),
    )


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.post("/thinklets", response_model=ThinkletResponse, status_code=201)
async def publish_thinklet(
    payload: ThinkletCreate,
    # current_user: User = Depends(get_current_user),  # uncomment when auth is ready
):
    """
    Publish a new Thinklet.
    Called by the MCP server after Claude generates the component code.
    """
    thinklet_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    # TODO: save to your DB here
    # record = await db.create_thinklet(
    #     id=thinklet_id,
    #     title=payload.title,
    #     description=payload.description,
    #     code=payload.code,
    #     tags=payload.tags,
    #     author=current_user.id,
    #     created_at=now,
    # )

    # Stub response — replace with real DB call above
    record = {
        "id": thinklet_id,
        "title": payload.title,
        "description": payload.description,
        "code": payload.code,
        "tags": payload.tags,
        "created_at": now,
        "author": None,
    }

    return _build_response(record)


@router.get("/thinklets/search", response_model=ThinkletSearchResponse)
async def search_thinklets(
    q: str = Query(..., description="Natural language search query"),
    limit: int = Query(5, ge=1, le=20, description="Max results"),
):
    """
    Search Thinklets by natural language query.
    Called by agents discovering existing tools before building new ones.

    TODO: implement semantic search using pgvector / Supabase vector search.
    Suggested approach:
      1. Embed the query with text-embedding-3-small
      2. Vector search against stored title+description embeddings
      3. Re-rank by recency + usage count
    """
    # TODO: replace with real semantic search
    # results = await db.search_thinklets(query=q, limit=limit)

    # Stub — returns empty until DB is wired up
    results: list[dict] = []

    return ThinkletSearchResponse(
        results=[_build_response(r) for r in results],
        total=len(results),
        query=q,
    )


@router.get("/thinklets/{thinklet_id}", response_model=ThinkletResponse)
async def get_thinklet(thinklet_id: str):
    """
    Fetch a single Thinklet by ID.
    Used by the MCP server to render a specific Thinklet inline.
    """
    # TODO: replace with real DB lookup
    # record = await db.get_thinklet(thinklet_id)
    record = None

    if not record:
        raise HTTPException(status_code=404, detail=f"Thinklet '{thinklet_id}' not found")

    return _build_response(record)
