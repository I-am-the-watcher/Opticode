// App.tsx
// Auth state is driven by auth.ts which stores the JWT token
// and user info in localStorage under 'token' and 'user' keys.

import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import OptimizePage from './pages/OptimizePage';
import HistoryPage from './pages/HistoryPage';
import ProfilePage from './pages/ProfilePage';
import { auth } from './auth';

const App: React.FC = () => {
  // null = not logged in, string = user's display name
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // On first load: read the saved user from localStorage.
  // auth.getUser() reads the 'user' key that auth.ts saves on login.
  // No server call needed here — the token is verified on each API request.
  useEffect(() => {
    const user = auth.getUser();
    setCurrentUserName(user ? user.name : null);
    setAuthChecked(true);
  }, []);

  const handleLogout = () => {
    auth.logout();             // removes 'token' and 'user' from localStorage
    setCurrentUserName(null);
  };

  // Show nothing while we check auth to avoid flash-of-wrong-page
  if (!authChecked) return null;

  const ProtectedPage = (component: React.ReactNode) => {
    if (!currentUserName) return <Navigate to="/login" />;
    return (
      <Layout user={currentUserName} onLogout={handleLogout}>
        {component}
      </Layout>
    );
  };

  return (
    <HashRouter>
      <Routes>

        {/* Root: logged in → optimize, else → landing */}
        <Route
          path="/"
          element={currentUserName ? <Navigate to="/optimize" /> : <LandingPage />}
        />

        {/* Login/Register: already logged in → redirect away */}
        <Route
          path="/login"
          element={
            currentUserName
              ? <Navigate to="/optimize" />
              : <LoginPage onLogin={(name) => setCurrentUserName(name)} />
          }
        />

        {/* Protected routes */}
        <Route path="/optimize" element={ProtectedPage(<OptimizePage />)} />
        <Route path="/history"  element={ProtectedPage(<HistoryPage />)} />
        <Route path="/profile"  element={ProtectedPage(<ProfilePage />)} />

        {/* Catch-all */}
        <Route
          path="*"
          element={<Navigate to={currentUserName ? "/optimize" : "/"} />}
        />

      </Routes>
    </HashRouter>
  );
};

export default App;