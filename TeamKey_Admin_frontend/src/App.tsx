import { ConfigProvider, theme } from 'antd';
import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import AppRoutes from './routes/AppRoutes';
import { setAuthToken } from './api/client';

const AuthSync: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token } = useAuth();
  useEffect(() => {
    setAuthToken(token);
  }, [token]);
  return <>{children}</>;
};

const ThemeWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ConfigProvider
    theme={{
      algorithm: theme.defaultAlgorithm,
      token: {
        colorPrimary: '#4527A0',
        borderRadiusLG: 16,
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      },
      components: {
        Layout: {
          headerBg: '#ffffff',
        },
      },
    }}
  >
    {children}
  </ConfigProvider>
);

const AppContainer: React.FC = () => (
  <AuthProvider>
    <AuthSync>
      <ThemeWrapper>
        <AppRoutes />
      </ThemeWrapper>
    </AuthSync>
  </AuthProvider>
);

export default AppContainer;
