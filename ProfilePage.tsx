/**
 * ProfilePage.tsx
 * Stats are fetched from MongoDB via /api/profile/stats (aggregation pipeline).
 */

import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authApi, profileApi, UserStats, User } from '../api';

const StatCard: React.FC<{ icon: string; label: string; value: string | number; sub?: string; accent?: string }> = ({ icon, label, value, sub, accent = '#63c88c' }) => (
  <div style={{
    background: 'rgba(15,20,30,0.8)', border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 14, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 4,
  }}>
    <span style={{ fontSize: 24 }}>{icon}</span>
    <span style={{ fontSize: 26, fontWeight: 800, color: accent, fontFamily: 'monospace', marginTop: 4 }}>{value}</span>
    <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{label}</span>
    {sub && <span style={{ fontSize: 12, color: '#475569' }}>{sub}</span>}
  </div>
);

const ProfilePage: React.FC = () => {
  const navigate = useNavigate();

  const [user,  setUser]  = useState<User | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authApi.isLoggedIn()) { navigate('/login'); return; }

    // Load user info and stats in parallel
    Promise.all([authApi.getMe(), profileApi.getStats()])
      .then(([u, s]) => { setUser(u); setStats(s); })
      .catch(() => navigate('/login'))
      .finally(() => setLoading(false));
  }, [navigate]);

  if (loading) return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #050c18 0%, #0a1628 50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontFamily: 'sans-serif' }}>
      Loading profile…
    </div>
  );

  if (!user || !stats) return null;

  const initials = user.name.slice(0, 2).toUpperCase();
  const joinedLabel = user.created_at
    ? new Date(user.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'Unknown';
  const lastActiveLabel = stats.last_active
    ? new Date(stats.last_active).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Never';

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #050c18 0%, #0a1628 50%, #07101f 100%)',
      fontFamily: '"Inter", "Segoe UI", sans-serif', color: '#e2e8f0',
    }}>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '40px 24px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 36, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, background: 'linear-gradient(90deg, #e2e8f0, #94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              My Profile
            </h1>
            <p style={{ fontSize: 14, color: '#475569', margin: '6px 0 0' }}>Member since {joinedLabel}</p>
          </div>
          <Link to="/history" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'rgba(99,200,140,0.1)', border: '1px solid rgba(99,200,140,0.25)',
            color: '#63c88c', textDecoration: 'none', padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
          }}>🕐 View History →</Link>
        </div>

        {/* Identity card */}
        <div style={{
          background: 'rgba(15,20,30,0.8)', border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 16, padding: '28px', marginBottom: 24,
          display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: 'linear-gradient(135deg, #1e3a5f, #0f2744)',
            border: '2px solid rgba(99,200,140,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 26, fontWeight: 800, color: '#63c88c', flexShrink: 0,
          }}>{initials}</div>
          <div>
            <p style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: '#e2e8f0' }}>{user.name}</p>
            <p style={{ margin: 0, fontSize: 14, color: '#64748b' }}>{user.email}</p>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: '#334155' }}>ID: {user._id}</p>
          </div>
        </div>

        {/* Stats */}
        <h2 style={{ fontSize: 14, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 14 }}>
          Activity Stats · from MongoDB
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 32 }}>
          <StatCard icon="📊" label="Total Sessions"    value={stats.total}         sub="All time" />
          <StatCard icon="⚙️" label="Rule-Based"        value={stats.level1_count}  sub="Level 1" accent="#60a5fa" />
          <StatCard icon="🤖" label="AI Optimizations"  value={stats.level2_count}  sub="Level 2" accent="#a78bfa" />
          <StatCard icon="★"  label="Starred"           value={stats.starred_count} sub="Favourites" accent="#fbbf24" />
          <StatCard icon="🕐" label="Last Active"       value={lastActiveLabel}     accent="#94a3b8" />
        </div>

        {/* Quick actions */}
        <h2 style={{ fontSize: 14, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 14 }}>Quick Actions</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link to="/optimize" style={{
            display: 'inline-block', background: 'linear-gradient(135deg, #63c88c, #4ade80)',
            color: '#0a1628', textDecoration: 'none', padding: '10px 22px', borderRadius: 8, fontSize: 13, fontWeight: 700,
          }}>⚡ New Optimization</Link>
          <Link to="/history" style={{
            display: 'inline-block', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            color: '#94a3b8', textDecoration: 'none', padding: '10px 22px', borderRadius: 8, fontSize: 13,
          }}>🕐 Browse History</Link>
        </div>

        <div style={{ height: 60 }} />
      </div>
    </div>
  );
};

export default ProfilePage;