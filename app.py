# app.py
"""
Flask backend — OptiCode AI

Endpoints
─────────
POST /api/auth/register        — create account
POST /api/auth/login           — get JWT token
GET  /api/auth/me              — get current user info  (requires token)

POST /api/analyse              — run optimization       (requires token)

GET  /api/history              — get all sessions       (requires token)
DELETE /api/history/<id>       — delete a session       (requires token)
PATCH  /api/history/<id>/rename — rename a session      (requires token)
PATCH  /api/history/<id>/star  — toggle star            (requires token)

GET  /api/profile/stats        — aggregated stats       (requires token)

GET  /api/health               — liveness probe
"""

import asyncio
import traceback

import bcrypt
import jwt as pyjwt
from datetime import datetime, timedelta, timezone
from functools import wraps

from flask import Flask, jsonify, request, g
from flask_cors import CORS

from database import (
    create_user,
    find_user_by_email,
    find_user_by_id,
    save_optimization,
    get_user_optimizations,
    get_optimization_by_id,
    delete_optimization,
    rename_optimization,
    toggle_star,
    get_user_stats,
)
from core.pipeline import run_pipeline

import os
from dotenv import load_dotenv
load_dotenv()

# ─────────────────────────────────────────────────────────────────────────────
# APP SETUP
# ─────────────────────────────────────────────────────────────────────────────

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

JWT_SECRET  = os.getenv("JWT_SECRET_KEY", "change_this_in_production")
JWT_ALGO    = "HS256"
JWT_EXPIRES = timedelta(days=7)

VALID_LEVELS = {"none", "level1", "level2"}

_LEVEL_ALIASES = {
    "LEVEL_1": "level1", "LEVEL_2": "level2",
    "level_1": "level1", "level_2": "level2",
}


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _run_async(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _error(message: str, status: int = 400):
    return jsonify({"error": message}), status


def _make_token(user_id: str, name: str, email: str) -> str:
    payload = {
        "sub":   user_id,
        "name":  name,
        "email": email,
        "iat":   datetime.now(timezone.utc),
        "exp":   datetime.now(timezone.utc) + JWT_EXPIRES,
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def require_auth(f):
    """
    Decorator that protects a route by validating the JWT token.
    After this runs, g.user_id / g.user_name / g.user_email are available.
    """
    @wraps(f)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return _error("Missing or invalid Authorization header", 401)
        token = auth_header.split(" ", 1)[1]
        try:
            payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
        except pyjwt.ExpiredSignatureError:
            return _error("Token has expired — please log in again", 401)
        except pyjwt.InvalidTokenError:
            return _error("Invalid token", 401)
        g.user_id    = payload["sub"]
        g.user_name  = payload.get("name", "")
        g.user_email = payload.get("email", "")
        return f(*args, **kwargs)
    return wrapper


# ─────────────────────────────────────────────────────────────────────────────
# AUTH ROUTES
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/auth/register", methods=["POST"])
def register():
    body     = request.get_json(force=True, silent=True) or {}
    name     = (body.get("name",     "") or "").strip()
    email    = (body.get("email",    "") or "").strip().lower()
    password = (body.get("password", "") or "").strip()

    if not name or not email or not password:
        return _error("name, email and password are all required")
    if len(password) < 6:
        return _error("Password must be at least 6 characters")

    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt(12)).decode()

    try:
        user = create_user(name, email, hashed)
    except Exception as e:
        if "duplicate" in str(e).lower() or "11000" in str(e):
            return _error("An account with that email already exists", 409)
        traceback.print_exc()
        return _error("Could not create account", 500)

    token = _make_token(user["_id"], user["name"], user["email"])
    return jsonify({"token": token, "user": user}), 201


@app.route("/api/auth/login", methods=["POST"])
def login():
    body     = request.get_json(force=True, silent=True) or {}
    email    = (body.get("email",    "") or "").strip().lower()
    password = (body.get("password", "") or "").strip()

    if not email or not password:
        return _error("email and password are required")

    user_doc = find_user_by_email(email)
    if not user_doc:
        return _error("Invalid email or password", 401)

    if not bcrypt.checkpw(password.encode(), user_doc["password"].encode()):
        return _error("Invalid email or password", 401)

    user = {
        "_id":   str(user_doc["_id"]),
        "name":  user_doc["name"],
        "email": user_doc["email"],
    }
    token = _make_token(user["_id"], user["name"], user["email"])
    return jsonify({"token": token, "user": user}), 200


@app.route("/api/auth/me", methods=["GET"])
@require_auth
def me():
    user = find_user_by_id(g.user_id)
    if not user:
        return _error("User not found", 404)
    return jsonify({"user": user}), 200


# ─────────────────────────────────────────────────────────────────────────────
# ANALYSE  (now requires auth + auto-saves)
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/analyse", methods=["POST"])
@require_auth
def analyse():
    body = request.get_json(force=True, silent=True)
    if body is None:
        return _error("Request body must be valid JSON")

    code = body.get("code", "")
    if not isinstance(code, str) or not code.strip():
        return _error("'code' field is required and must be a non-empty string")

    optimization_level = body.get("optimization_level", "none")
    optimization_level = _LEVEL_ALIASES.get(optimization_level, optimization_level)
    if optimization_level not in VALID_LEVELS:
        return _error(f"'optimization_level' must be one of: {sorted(VALID_LEVELS)}")

    try:
        result = _run_async(run_pipeline(code, optimization_level))
    except Exception:
        traceback.print_exc()
        return _error("Internal server error — check server logs for details.", 500)

    # Auto-save to MongoDB
    session_id = None
    if result.get("passed_error_check"):
        if optimization_level == "level1":
            changes = result.get("l1_changes", [])
        elif optimization_level == "level2":
            changes = result.get("l2", {}).get("changes_applied", [])
        else:
            changes = []

        try:
            saved = save_optimization(
                user_id            = g.user_id,
                original_code      = result.get("original_code", ""),
                optimized_code     = result.get("optimized_code", ""),
                level              = optimization_level,
                changes            = changes,
                original_analysis  = result.get("original_analysis") or {},
                optimized_analysis = result.get("optimized_analysis") or {},
                error              = result.get("error"),
            )
            session_id = saved["_id"]
        except Exception:
            traceback.print_exc()

    result["session_id"] = session_id
    return jsonify(result), 200


# ─────────────────────────────────────────────────────────────────────────────
# HISTORY ROUTES
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/history", methods=["GET"])
@require_auth
def get_history():
    sessions = get_user_optimizations(g.user_id)
    return jsonify({"sessions": sessions}), 200


@app.route("/api/history/<session_id>", methods=["DELETE"])
@require_auth
def delete_session(session_id: str):
    success = delete_optimization(session_id, g.user_id)
    if not success:
        return _error("Session not found or not yours", 404)
    return jsonify({"deleted": True}), 200


@app.route("/api/history/<session_id>/rename", methods=["PATCH"])
@require_auth
def rename_session(session_id: str):
    body     = request.get_json(force=True, silent=True) or {}
    new_name = (body.get("name", "") or "").strip()
    if not new_name:
        return _error("'name' is required")
    success = rename_optimization(session_id, g.user_id, new_name)
    if not success:
        return _error("Session not found or not yours", 404)
    return jsonify({"renamed": True}), 200


@app.route("/api/history/<session_id>/star", methods=["PATCH"])
@require_auth
def star_session(session_id: str):
    new_val = toggle_star(session_id, g.user_id)
    if new_val is None:
        return _error("Session not found or not yours", 404)
    return jsonify({"starred": new_val}), 200


# ─────────────────────────────────────────────────────────────────────────────
# PROFILE
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/profile/stats", methods=["GET"])
@require_auth
def profile_stats():
    stats = get_user_stats(g.user_id)
    return jsonify({"stats": stats}), 200


# ─────────────────────────────────────────────────────────────────────────────
# HEALTH
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"}), 200


# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)