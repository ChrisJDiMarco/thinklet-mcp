"""
Thinklet API — FastAPI route stubs
Abhi: wire each TODO to your DB layer (Supabase + pgvector recommended).

Routes:
  POST   /api/v1/thinklets                   publish a new Thinklet
  GET    /api/v1/thinklets/search?q=&limit=  semantic search
  GET    /api/v1/thinklets/{id}              fetch by ID
  POST   /api/v1/thinklets/{id}/remix        create a linked remix
"""

from fastapi import APIRouter, HTTPException, Query
from .models import ThinkletCreate, ThinkletRemixCreate, ThinkletResponse, ThinkletSearchResponse

router = APIRouter(prefix="/api/v1/thinklets", tags=["thinklets"])


# ── POST /api/v1/thinklets ─────────────────────────────────────────────────

@router.post("", response_model=ThinkletResponse, status_code=201)
async def publish_thinklet(payload: ThinkletCreate):
    """
    Publish a new Thinklet.

    TODO:
    1. Validate that `payload.code` is valid JSX (optional but recommended)
    2. Generate an embedding for semantic search:
         embedding = await embed(f"{payload.title} {payload.description} {' '.join(payload.tags)}")
    3. Insert into DB:
         record = await db.thinklets.insert({
             "code": payload.code,
             "title": payload.title,
             "description": payload.description,
             "tags": payload.tags,
             "visibility": payload.visibility,
             "embedding": embedding,
             "author_id": current_user.id,   # from auth middleware
         })
    4. Return ThinkletResponse with live url + embed_url
    """
    raise HTTPException(status_code=501, detail="Not implemented — wire to your DB")


# ── GET /api/v1/thinklets/search ──────────────────────────────────────────

@router.get("/search", response_model=ThinkletSearchResponse)
async def search_thinklets(
    q: str = Query(..., description="Natural language search query"),
    limit: int = Query(5, ge=1, le=10),
):
    """
    Semantic search over the Thinklet catalog.

    TODO:
    1. Generate embedding for the query:
         query_embedding = await embed(q)
    2. Run a vector similarity search (pgvector example):
         results = await db.execute(
             "SELECT *, 1 - (embedding <=> $1) AS score "
             "FROM thinklets "
             "WHERE visibility = 'public' "
             "ORDER BY embedding <=> $1 "
             "LIMIT $2",
             [query_embedding, limit]
         )
    3. Return results as list of ThinkletResponse

    Recommended: Supabase with pgvector extension, or Pinecone for managed vector search.
    """
    raise HTTPException(status_code=501, detail="Not implemented — wire to your vector DB")


# ── GET /api/v1/thinklets/{id} ────────────────────────────────────────────

@router.get("/{thinklet_id}", response_model=ThinkletResponse)
async def get_thinklet(thinklet_id: str):
    """
    Fetch a single Thinklet by ID.

    TODO:
    1. Query DB: record = await db.thinklets.find_one({"id": thinklet_id})
    2. If not found: raise HTTPException(404)
    3. If visibility == "private": check auth, raise 403 if not owner
    4. Return ThinkletResponse
    """
    raise HTTPException(status_code=501, detail="Not implemented — wire to your DB")


# ── POST /api/v1/thinklets/{id}/remix ────────────────────────────────────

@router.post("/{thinklet_id}/remix", response_model=ThinkletResponse, status_code=201)
async def remix_thinklet(thinklet_id: str, payload: ThinkletRemixCreate):
    """
    Create a remix of an existing Thinklet.

    The remix is a new Thinklet linked back to the original via `original_id`.
    The actual code adaptation is done by Claude (via the MCP server) before
    this endpoint is called — this endpoint just stores the result.

    TODO:
    1. Fetch original: original = await db.thinklets.find_one({"id": thinklet_id})
    2. If not found or private (and not owner): raise 404 / 403
    3. Generate embedding for the remix
    4. Insert remix as a new Thinklet record with original_id set:
         record = await db.thinklets.insert({
             "code": payload.code,
             "title": payload.title,
             "description": payload.description,
             "tags": payload.tags,
             "visibility": payload.visibility,
             "embedding": embedding,
             "original_id": thinklet_id,   # links back to source
             "author_id": current_user.id,
         })
    5. Increment original's remix_count:
         await db.thinklets.update({"id": thinklet_id}, {"$inc": {"remix_count": 1}})
    6. Return ThinkletResponse for the new remix (include original_url)
    """
    raise HTTPException(status_code=501, detail="Not implemented — wire to your DB")
