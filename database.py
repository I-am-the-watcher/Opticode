# database.py
"""
MongoDB connection and all database operations.

Collections
-----------
users          — one document per registered account
optimizations  — one document per optimization run, linked to a user via user_id
"""

from pymongo import MongoClient, DESCENDING
from pymongo.errors import DuplicateKeyError
from datetime import datetime
from bson import ObjectId
import os
from dotenv import load_dotenv

load_dotenv()

# ─────────────────────────────────────────────────────────────────────────────
# CONNECTION
# ─────────────────────────────────────────────────────────────────────────────

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/opticode")

client = MongoClient(MONGO_URI)
db     = client.get_database()

users_collection         = db["users"]
optimizations_collection = db["optimizations"]

# Unique index on email — two accounts can't share one address
users_collection.create_index("email", unique=True)

# Compound index so history queries (user_id + date sort) are fast
optimizations_collection.create_index([("user_id", 1), ("created_at", DESCENDING)])


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _serialize_user(doc: dict) -> dict:
    """Convert a raw MongoDB user document to a JSON-safe dict."""
    if doc is None:
        return None
    return {
        "_id":        str(doc["_id"]),
        "name":       doc.get("name", ""),
        "email":      doc.get("email", ""),
        "created_at": doc["created_at"].isoformat() if "created_at" in doc else None,
    }


def _serialize_optimization(doc: dict) -> dict:
    """Convert a raw MongoDB optimization document to a JSON-safe dict."""
    if doc is None:
        return None
    return {
        "_id":                str(doc["_id"]),
        "user_id":            doc.get("user_id", ""),
        "name":               doc.get("name", ""),
        "original_code":      doc.get("original_code", ""),
        "optimized_code":     doc.get("optimized_code", ""),
        "level":              doc.get("level", "none"),
        "changes":            doc.get("changes", []),
        "original_analysis":  doc.get("original_analysis"),
        "optimized_analysis": doc.get("optimized_analysis"),
        "error":              doc.get("error"),
        "starred":            doc.get("starred", False),
        "created_at":         doc["created_at"].isoformat() if "created_at" in doc else None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# USER OPERATIONS
# ─────────────────────────────────────────────────────────────────────────────

def create_user(name: str, email: str, hashed_password: str) -> dict:
    """
    Insert a new user document.
    Returns the created user (without password) or raises DuplicateKeyError
    if the email is already registered.
    """
    doc = {
        "name":       name,
        "email":      email.lower().strip(),
        "password":   hashed_password,
        "created_at": datetime.utcnow(),
    }
    result = users_collection.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return _serialize_user(doc)


def find_user_by_email(email: str) -> dict | None:
    """
    Return the full user document (including hashed password) so the
    auth route can verify the submitted password against the stored hash.
    """
    return users_collection.find_one({"email": email.lower().strip()})


def find_user_by_id(user_id: str) -> dict | None:
    """Return a serialized user document by MongoDB _id string."""
    doc = users_collection.find_one({"_id": ObjectId(user_id)})
    return _serialize_user(doc)


# ─────────────────────────────────────────────────────────────────────────────
# OPTIMIZATION HISTORY OPERATIONS
# ─────────────────────────────────────────────────────────────────────────────

def save_optimization(
    user_id:            str,
    original_code:      str,
    optimized_code:     str,
    level:              str,
    changes:            list,
    original_analysis:  dict,
    optimized_analysis: dict,
    error:              str | None = None,
) -> dict:
    """Persist one optimization run for a user."""
    name = f"Session · {datetime.utcnow().strftime('%d %b %Y, %H:%M')}"

    doc = {
        "user_id":            user_id,
        "name":               name,
        "original_code":      original_code,
        "optimized_code":     optimized_code,
        "level":              level,
        "changes":            changes,
        "original_analysis":  original_analysis,
        "optimized_analysis": optimized_analysis,
        "error":              error,
        "starred":            False,
        "created_at":         datetime.utcnow(),
    }

    result = optimizations_collection.insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return _serialize_optimization(doc)


def get_user_optimizations(user_id: str) -> list:
    """Return all optimization sessions for user_id, newest first."""
    cursor = optimizations_collection.find(
        {"user_id": user_id}
    ).sort("created_at", DESCENDING)

    return [_serialize_optimization(doc) for doc in cursor]


def get_optimization_by_id(optimization_id: str, user_id: str) -> dict | None:
    """Fetch a single session, enforcing user_id ownership check."""
    doc = optimizations_collection.find_one({
        "_id":     ObjectId(optimization_id),
        "user_id": user_id,
    })
    return _serialize_optimization(doc)


def delete_optimization(optimization_id: str, user_id: str) -> bool:
    """Delete a session. Returns True if something was deleted."""
    result = optimizations_collection.delete_one({
        "_id":     ObjectId(optimization_id),
        "user_id": user_id,
    })
    return result.deleted_count > 0


def rename_optimization(optimization_id: str, user_id: str, new_name: str) -> bool:
    """Rename a session. Returns True on success."""
    result = optimizations_collection.update_one(
        {"_id": ObjectId(optimization_id), "user_id": user_id},
        {"$set": {"name": new_name}},
    )
    return result.modified_count > 0


def toggle_star(optimization_id: str, user_id: str) -> bool | None:
    """Flip the starred flag. Returns the NEW starred value, or None if not found."""
    doc = optimizations_collection.find_one({
        "_id":     ObjectId(optimization_id),
        "user_id": user_id,
    })
    if not doc:
        return None
    new_val = not doc.get("starred", False)
    optimizations_collection.update_one(
        {"_id": ObjectId(optimization_id)},
        {"$set": {"starred": new_val}},
    )
    return new_val


def get_user_stats(user_id: str) -> dict:
    """Aggregate stats for the Profile page using MongoDB aggregation pipeline."""
    pipeline = [
        {"$match": {"user_id": user_id}},
        {"$group": {
            "_id":           None,
            "total":         {"$sum": 1},
            "level1_count":  {"$sum": {"$cond": [{"$eq": ["$level", "level1"]}, 1, 0]}},
            "level2_count":  {"$sum": {"$cond": [{"$eq": ["$level", "level2"]}, 1, 0]}},
            "starred_count": {"$sum": {"$cond": ["$starred", 1, 0]}},
            "last_active":   {"$max": "$created_at"},
        }},
    ]

    results = list(optimizations_collection.aggregate(pipeline))

    if not results:
        return {
            "total": 0, "level1_count": 0, "level2_count": 0,
            "starred_count": 0, "last_active": None,
        }

    row = results[0]
    return {
        "total":         row["total"],
        "level1_count":  row["level1_count"],
        "level2_count":  row["level2_count"],
        "starred_count": row["starred_count"],
        "last_active":   row["last_active"].isoformat() if row.get("last_active") else None,
    }