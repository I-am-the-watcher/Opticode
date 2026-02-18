import React from 'react';
import { useNavigate } from 'react-router-dom';

const LandingPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: 'white',
      padding: '20px'
    }}>
      <h1 style={{ fontSize: '3rem', marginBottom: '20px' }}>
        Welcome to Opticode
      </h1>
      <p style={{ fontSize: '1.5rem', marginBottom: '40px', textAlign: 'center' }}>
        Optimize your AI prompts with intelligent analysis
      </p>
      <button
        onClick={() => navigate('/optimize')}
        style={{
          padding: '15px 40px',
          fontSize: '1.2rem',
          background: 'white',
          color: '#667eea',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          fontWeight: 'bold',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
        }}
      >
        Get Started
      </button>
    </div>
  );
};

export default LandingPage;