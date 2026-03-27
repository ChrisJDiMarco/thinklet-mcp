"""
Thinklet API — Pydantic models
Drop this into your existing FastAPI project.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field
import uuid


class ThinkletCreate(BaseModel):
    """Request body for publishing a new Thinklet."""
    code: str = Field(..., description="Complete React component source code")
    title: str = Field(..., max_length=80, description="Short display title")
    description: str = Field(..., max_length=300, description="One-sentence description")
    tags: list[str] = Field(default_factory=list, description="Discovery tags")


class ThinkletResponse(BaseModel):
    """Full Thinklet record returned from the API."""
    id: str
    title: str
    description: str
    tags: list[str]
    url: str
    embed_url: str
    created_at: datetime
    author: Optional[str] = None

    model_config = {"from_attributes": True}


class ThinkletSearchResponse(BaseModel):
    results: list[ThinkletResponse]
    total: int
    query: str
