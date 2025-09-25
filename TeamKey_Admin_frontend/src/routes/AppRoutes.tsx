import React from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import LoginPage from '../pages/Login';
import BootstrapPage from '../pages/Bootstrap';
import DashboardPage from '../pages/Dashboard';
import UsersPage from '../pages/Users';
import TeamsPage from '../pages/Teams';
import AccountsPage from '../pages/Accounts';
import LogsPage from '../pages/Logs';
import SettingsPage from '../pages/Settings';
import AdminLayout from '../components/AdminLayout';

const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token, profile } = useAuth();
  const location = useLocation();
  if (!token) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (profile && !profile.installed && location.pathname !== '/bootstrap') {
    return <Navigate to="/bootstrap" replace />;
  }
  return <>{children}</>;
};

const RequireTokenOnly: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token, profile } = useAuth();
  const location = useLocation();
  if (!token) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (profile?.installed) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
};

const AnonymousOnly: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token, profile } = useAuth();
  if (token && profile?.installed) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
};

const AppRoutes: React.FC = () => (
  <Routes>
    <Route
      path="/login"
      element={
        <AnonymousOnly>
          <LoginPage />
        </AnonymousOnly>
      }
    />
    <Route
      path="/bootstrap"
      element={
        <RequireTokenOnly>
          <BootstrapPage />
        </RequireTokenOnly>
      }
    />
    <Route
      element={
        <RequireAuth>
          <AdminLayout />
        </RequireAuth>
      }
    >
      <Route index element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/users" element={<UsersPage />} />
      <Route path="/teams" element={<TeamsPage />} />
      <Route path="/accounts" element={<AccountsPage />} />
      <Route path="/logs" element={<LogsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Route>
    <Route path="*" element={<Navigate to="/dashboard" replace />} />
  </Routes>
);

export default AppRoutes;
