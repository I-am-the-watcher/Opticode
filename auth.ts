// auth.ts - handles all authentication with the real backend

const API_URL = 'http://localhost:5000/api';

export const auth = {
  // Save token after login
  saveToken(token: string, user: any): void {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  },

  // Get the saved token
  getToken(): string | null {
    return localStorage.getItem('token');
  },

  // Get the saved user
  getUser(): any {
    const user = localStorage.getItem('user');
    return user ? JSON.parse(user) : null;
  },

  // Get user's name
  getUserName(): string | null {
    const user = this.getUser();
    return user ? user.name : null;
  },

  // Check if logged in
  isAuthenticated(): boolean {
    return this.getToken() !== null;
  },

  // Logout
  logout(): void {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },

  // Register new account
  async register(name: string, email: string, password: string): Promise<any> {
    const response = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    this.saveToken(data.token, data.user);
    return data;
  },

  // Login
  async login(email: string, password: string): Promise<any> {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    this.saveToken(data.token, data.user);
    return data;
  }
};