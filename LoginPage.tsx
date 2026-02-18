import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../auth';

interface LoginPageProps {
  onLogin: (userName: string) => void;
}

const LoginPage: React.FC<LoginPageProps> = ({ onLogin }) => {
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isRegister) {
        // Create new account
        const data = await auth.register(name, email, password);
        onLogin(data.user.name);
      } else {
        // Login to existing account
        const data = await auth.login(email, password);
        onLogin(data.user.name);
      }
      navigate('/optimize');
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
    }}>
      <div style={{
        background: 'white',
        padding: '40px',
        borderRadius: '15px',
        boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
        width: '100%',
        maxWidth: '450px'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <h1 style={{ color: '#667eea', margin: 0, marginBottom: '10px' }}>OptiCode</h1>
          <h2 style={{ margin: 0, fontSize: '1.5rem' }}>
            {isRegister ? 'Create Account' : 'Welcome Back!'}
          </h2>
          <p style={{ color: '#666', marginTop: '10px' }}>
            {isRegister ? 'Join OptiCode today' : 'Login to optimize your Python code'}
          </p>
        </div>

        {error && (
          <div style={{
            background: '#fee',
            color: '#c00',
            padding: '12px',
            borderRadius: '8px',
            marginBottom: '20px',
            fontSize: '0.9rem'
          }}>
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {isRegister && (
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                Full Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="John Doe"
                style={{
                  width: '100%',
                  padding: '12px 15px',
                  borderRadius: '8px',
                  border: '2px solid #e0e0e0',
                  fontSize: '1rem',
                  boxSizing: 'border-box'
                }}
              />
            </div>
          )}

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              style={{
                width: '100%',
                padding: '12px 15px',
                borderRadius: '8px',
                border: '2px solid #e0e0e0',
                fontSize: '1rem',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div style={{ marginBottom: '25px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              minLength={6}
              style={{
                width: '100%',
                padding: '12px 15px',
                borderRadius: '8px',
                border: '2px solid #e0e0e0',
                fontSize: '1rem',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '14px',
              background: loading ? '#ccc' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '1.1rem',
              fontWeight: 'bold'
            }}
          >
            {loading ? '⏳ Please wait...' : (isRegister ? 'Create Account' : 'Login to OptiCode')}
          </button>
        </form>

        <div style={{ 
          marginTop: '20px', 
          textAlign: 'center',
          color: '#666',
          fontSize: '0.9rem'
        }}>
          {isRegister ? 'Already have an account? ' : "Don't have an account? "}
          <span
            onClick={() => { setIsRegister(!isRegister); setError(''); }}
            style={{ color: '#667eea', cursor: 'pointer', fontWeight: 'bold' }}
          >
            {isRegister ? 'Login' : 'Sign Up'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;