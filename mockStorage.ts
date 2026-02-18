export const mockAuth = {
  isAuthenticated(): boolean {
    return localStorage.getItem('currentUser') !== null;
  },

  getUserName(): string | null {
    return localStorage.getItem('currentUser');
  },

  login(userName: string): void {
    localStorage.setItem('currentUser', userName);
  },

  logout(): void {
    localStorage.removeItem('currentUser');
  }
};