from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.db import Database
from backend.dependencies import get_database

logger = logging.getLogger("almanac.context")
router = APIRouter()


class UserProfile(BaseModel):
    # Location
    state: Optional[str] = None
    region_description: Optional[str] = None  # "rural Minnesota", "urban apartment in Birmingham AL"
    usda_zone: Optional[str] = None  # "4b", "8a", etc.
    climate: Optional[str] = None  # "cold continental", "humid subtropical", etc.

    # Living situation
    dwelling: Optional[str] = None  # "house", "apartment", "mobile home", "cabin"
    property_size: Optional[str] = None  # "1/4 acre", "5 acres", "balcony only"
    setting: Optional[str] = None  # "rural", "suburban", "urban"

    # Household
    household_size: Optional[int] = None
    children: Optional[str] = None  # "none", "2 kids under 10", etc.
    pets: Optional[str] = None  # "2 dogs, 3 cats", "none"
    medical_needs: Optional[str] = None  # "diabetic family member", "none"

    # Infrastructure
    water_source: Optional[str] = None  # "municipal", "well", "spring", "rainwater"
    heating: Optional[str] = None  # "propane", "wood stove", "electric", "natural gas"
    power: Optional[str] = None  # "grid only", "grid + solar", "off-grid solar", "generator"
    sewage: Optional[str] = None  # "municipal sewer", "septic", "composting toilet"

    # Food production
    has_garden: Optional[bool] = None
    garden_size: Optional[str] = None  # "raised beds", "1/4 acre", "container only"
    livestock: Optional[str] = None  # "chickens", "goats and chickens", "none"
    food_storage: Optional[str] = None  # "basic pantry", "1 month supply", "6 month supply"
    fruit_trees: Optional[str] = None  # "apple and pear", "none"

    # Experience
    experience_level: Optional[str] = None  # "beginner", "intermediate", "experienced"
    skills: Optional[str] = None  # "basic gardening, some canning", "experienced woodworker"

    # Goals
    priorities: Optional[str] = None  # "general preparedness", "food self-sufficiency", "off-grid transition"
    preparing_for: Optional[str] = None  # "natural disasters", "economic disruption", "general resilience"

    # Freeform
    notes: Optional[str] = None  # Anything else relevant


def profile_to_prompt_context(profile: UserProfile) -> str:
    """Convert a user profile into a context block for the system prompt."""
    parts = []

    if profile.state or profile.region_description:
        location = profile.region_description or profile.state
        parts.append(f"Location: {location}")
        if profile.usda_zone:
            parts.append(f"USDA Hardiness Zone: {profile.usda_zone}")
        if profile.climate:
            parts.append(f"Climate: {profile.climate}")

    if profile.dwelling or profile.setting:
        living = []
        if profile.dwelling:
            living.append(profile.dwelling)
        if profile.setting:
            living.append(profile.setting)
        if profile.property_size:
            living.append(profile.property_size)
        parts.append(f"Living situation: {', '.join(living)}")

    if profile.household_size:
        household = f"Household: {profile.household_size} people"
        if profile.children:
            household += f", children: {profile.children}"
        if profile.pets:
            household += f", pets: {profile.pets}"
        parts.append(household)

    if profile.medical_needs:
        parts.append(f"Medical considerations: {profile.medical_needs}")

    infra = []
    if profile.water_source:
        infra.append(f"water: {profile.water_source}")
    if profile.heating:
        infra.append(f"heat: {profile.heating}")
    if profile.power:
        infra.append(f"power: {profile.power}")
    if infra:
        parts.append(f"Infrastructure: {', '.join(infra)}")

    food = []
    if profile.has_garden:
        food.append(f"garden ({profile.garden_size or 'yes'})")
    if profile.livestock:
        food.append(f"livestock: {profile.livestock}")
    if profile.fruit_trees:
        food.append(f"fruit trees: {profile.fruit_trees}")
    if profile.food_storage:
        food.append(f"food storage: {profile.food_storage}")
    if food:
        parts.append(f"Food production: {', '.join(food)}")

    if profile.experience_level:
        exp = f"Experience: {profile.experience_level}"
        if profile.skills:
            exp += f" ({profile.skills})"
        parts.append(exp)

    if profile.priorities or profile.preparing_for:
        goals = profile.priorities or profile.preparing_for
        parts.append(f"Goals: {goals}")

    if profile.notes:
        parts.append(f"Additional context: {profile.notes}")

    if not parts:
        return ""

    return "## User Context\n\n" + "\n".join(f"- {p}" for p in parts)


async def _ensure_table(db: Database):
    await db.execute("""
        CREATE TABLE IF NOT EXISTS user_profile (
            key TEXT PRIMARY KEY DEFAULT 'default',
            data TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)


@router.get("/api/context/profile")
async def get_profile(db: Database = Depends(get_database)):
    await _ensure_table(db)
    rows = await db.execute(
        "SELECT data FROM user_profile WHERE key = 'default'"
    )
    if rows:
        return json.loads(rows[0][0])
    return {}


@router.post("/api/context/profile")
async def save_profile(
    profile: UserProfile,
    db: Database = Depends(get_database),
):
    await _ensure_table(db)
    data = profile.model_dump(exclude_none=True)
    await db.execute(
        """INSERT OR REPLACE INTO user_profile (key, data, updated_at)
        VALUES ('default', ?, datetime('now'))""",
        (json.dumps(data),),
    )
    logger.info("User profile updated: %d fields", len(data))
    return {"status": "saved", "fields": len(data)}


@router.get("/api/context/prompt")
async def get_prompt_context(db: Database = Depends(get_database)):
    """Preview the context block that gets injected into prompts."""
    await _ensure_table(db)
    rows = await db.execute(
        "SELECT data FROM user_profile WHERE key = 'default'"
    )
    if rows:
        profile = UserProfile(**json.loads(rows[0][0]))
        return {"context": profile_to_prompt_context(profile)}
    return {"context": ""}
