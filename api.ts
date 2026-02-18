/**
 * api.ts
 * ══════════════════════════════════════════════════════════════
 * THE FRONTEND "DATABASE LAYER"
 *
 * Instead of reading/writing localStorage, every function here
 * makes an HTTP request to the Flask backend, which talks to MongoDB.
 *
 * HOW JWT AUTH WORKS END-TO-END:
 *
 *   1. User logs in → POST /api/auth/login
 *   2. Flask checks password, returns { token: "eyJ..." }
 *   3. We store that token in localStorage (just the token string, not data)
 *   4. Every subsequent request includes:
 *        Authorization: Bearer eyJ...
 *   5. Flask's @require_auth decorator verifies the token
 *   6. If valid → request proceeds; if not → 401 returned
 *
 * The token encodes who the user is. MongoDB uses user_id from the token
 * to filter data — you only ever see your own sessions.
 */

const API_BASE = 'http://localhost:5000';
const TOKEN_KEY = 'token';

// ─────────────────────────────────────────────────────────────
// TYPES  (match the shapes Flask returns)
// ─────────────────────────────────────────────────────────────

export interface User {
  _id: string;
  name: string;
  email: string;
  created_at?: string;
}

export interface SessionRecord {
  _id: string;
  user_id: string;
  name: string;
  original_code: string;
  optimized_code: string;
  level: 'none' | 'level1' | 'level2';
  changes: string[];
  original_analysis: Record<string, unknown> | null;
  optimized_analysis: Record<string, unknown> | null;
  error: string | null;
  starred: boolean;
  created_at: string;  // ISO string from MongoDB
}

export interface UserStats {
  total: number;
  level1_count: number;
  level2_count: number;
  starred_count: number;
  last_active: string | null;
}

export interface ApiAnalysisResult {
  passed_error_check: boolean;
  passed_complexity: boolean;
  optimization_ran: boolean;
  error_report: Record<string, unknown>;
  original_analysis: Record<string, unknown> | null;
  optimized_analysis: Record<string, unknown> | null;
  original_code: string;
  optimized_code: string;
  optimization_level: string;
  l1_changes: string[];
  l2: {
    winning_model: string;
    score: number;
    confidence: number;
    risk: string;
    changes_applied: string[];
    additional_suggestions: string[];
    ranked_models: Record<string, unknown>[];
    syntax_valid: boolean;
  };
  error: string | null;
  session_id: string | null;  // MongoDB _id of the saved session
}


// ─────────────────────────────────────────────────────────────
// TOKEN HELPERS  (localStorage only stores the JWT string)
// ─────────────────────────────────────────────────────────────

export const tokenStore = {
  get:    ()            => localStorage.getItem(TOKEN_KEY),
  set:    (t: string)   => localStorage.setItem(TOKEN_KEY, t),
  clear:  ()            => localStorage.removeItem(TOKEN_KEY),
  exists: ()            => !!localStorage.getItem(TOKEN_KEY),
};


// ─────────────────────────────────────────────────────────────
// BASE FETCH WRAPPER
// ─────────────────────────────────────────────────────────────

/**
 * apiFetch — all API calls go through here.
 *
 * It automatically:
 *   - Sets Content-Type: application/json
 *   - Attaches the Authorization header if a token exists
 *   - Parses the JSON response
 *   - Throws a proper Error if the server returns 4xx/5xx
 */
async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = tokenStore.get();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    // Use the server's error message if available
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data as T;
}


// ─────────────────────────────────────────────────────────────
// AUTH API
// ─────────────────────────────────────────────────────────────

export const authApi = {

  /** Register a new account. Stores the token on success. */
  register: async (name: string, email: string, password: string): Promise<User> => {
    const data = await apiFetch<{ token: string; user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    });
    tokenStore.set(data.token);
    return data.user;
  },

  /**
   * Log in with email + password.
   * Flask verifies the password hash and returns a JWT.
   * We store the JWT so future requests are authenticated.
   */
  login: async (email: string, password: string): Promise<User> => {
    const data = await apiFetch<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    tokenStore.set(data.token);
    return data.user;
  },

  /** Log out — just remove the token. No server call needed. */
  logout: (): void => {
    tokenStore.clear();
  },

  /**
   * Re-hydrate the current user from the token.
   * Call this on app load to check if the stored token is still valid.
   */
  getMe: async (): Promise<User | null> => {
    if (!tokenStore.exists()) return null;
    try {
      const data = await apiFetch<{ user: User }>('/api/auth/me');
      return data.user;
    } catch {
      // Token expired or invalid — clear it
      tokenStore.clear();
      return null;
    }
  },

  /** True if a token is stored (user is probably logged in). */
  isLoggedIn: (): boolean => tokenStore.exists(),
};


// ─────────────────────────────────────────────────────────────
// OPTIMIZATION API
// ─────────────────────────────────────────────────────────────

export const optimizeApi = {

  /**
   * Run the optimization pipeline.
   * The result is automatically saved to MongoDB by Flask.
   * Returns the full result including session_id.
   */
  analyse: async (
    code: string,
    optimizationLevel: 'none' | 'level1' | 'level2',
  ): Promise<ApiAnalysisResult> => {
    return apiFetch<ApiAnalysisResult>('/api/analyse', {
      method: 'POST',
      body: JSON.stringify({ code, optimization_level: optimizationLevel }),
    });
  },
};


// ─────────────────────────────────────────────────────────────
// HISTORY API
// ─────────────────────────────────────────────────────────────

export const historyApi = {

  /** Fetch all sessions for the logged-in user, newest first. */
  getAll: async (): Promise<SessionRecord[]> => {
    const data = await apiFetch<{ sessions: SessionRecord[] }>('/api/history');
    return data.sessions;
  },

  /** Delete a session by its MongoDB _id. */
  delete: async (sessionId: string): Promise<void> => {
    await apiFetch(`/api/history/${sessionId}`, { method: 'DELETE' });
  },

  /** Rename a session. */
  rename: async (sessionId: string, name: string): Promise<void> => {
    await apiFetch(`/api/history/${sessionId}/rename`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
  },

  /** Toggle the starred flag. Returns the new starred value. */
  toggleStar: async (sessionId: string): Promise<boolean> => {
    const data = await apiFetch<{ starred: boolean }>(`/api/history/${sessionId}/star`, {
      method: 'PATCH',
    });
    return data.starred;
  },
};


// ─────────────────────────────────────────────────────────────
// PROFILE API
// ─────────────────────────────────────────────────────────────

export const profileApi = {

  /** Get aggregated stats for the Profile page. */
  getStats: async (): Promise<UserStats> => {
    const data = await apiFetch<{ stats: UserStats }>('/api/profile/stats');
    return data.stats;
  },
};