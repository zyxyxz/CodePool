import axios from 'axios';

const API_PREFIX = import.meta.env.VITE_API_PREFIX || '/api/v1';

const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000',
  timeout: 8000,
});

let authToken: string | null = localStorage.getItem('TEAMKEY_ADMIN_TOKEN');

export const setAuthToken = (token: string | null) => {
  authToken = token;
};

client.interceptors.request.use((config) => {
  if (authToken) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

const withPrefix = (path: string) => `${API_PREFIX}${path}`;

export const adminApi = {
  login: (payload: { email: string; password: string }) => client.post(withPrefix('/admin/login'), payload),
  bootstrap: (payload: any) => client.post(withPrefix('/admin/bootstrap'), payload),
  getSettings: () => client.get(withPrefix('/admin/settings')),
  updateSettings: (payload: any) => client.put(withPrefix('/admin/settings'), payload),
  getStats: () => client.get(withPrefix('/admin/stats')),
  getUsers: (params: any) => client.get(withPrefix('/admin/users'), { params }),
  getTeams: (params: any) => client.get(withPrefix('/admin/teams'), { params }),
  getAccounts: (params: any) => client.get(withPrefix('/admin/accounts'), { params }),
  getLogs: (params: any) => client.get(withPrefix('/admin/logs'), { params }),
};

export default client;
