import { LogoutOutlined, SettingOutlined, TeamOutlined, UserOutlined, AppstoreOutlined, FileSearchOutlined, DashboardOutlined } from '@ant-design/icons';
import { Avatar, Button, Layout, Menu, Space } from 'antd';
import React, { useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const { Sider, Content, Header } = Layout;

const AdminLayout: React.FC = () => {
  const { profile, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const menuItems = useMemo(
    () => [
      { key: '/dashboard', icon: <DashboardOutlined />, label: '控制台' },
      { key: '/users', icon: <UserOutlined />, label: '用户管理' },
      { key: '/teams', icon: <TeamOutlined />, label: '团队管理' },
      { key: '/accounts', icon: <AppstoreOutlined />, label: '账号资产' },
      { key: '/logs', icon: <FileSearchOutlined />, label: '审计日志' },
      { key: '/settings', icon: <SettingOutlined />, label: '系统设置' },
    ],
    [],
  );

  return (
    <Layout>
      <Sider collapsible theme="dark">
        <div className="sider-logo">TeamKey</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#ffffff', padding: '0 24px' }}>
          <Space style={{ float: 'right' }}>
            <Avatar>{profile?.email?.slice(0, 1).toUpperCase()}</Avatar>
            <span>{profile?.email}</span>
            <Button icon={<LogoutOutlined />} type="text" onClick={() => { logout(); navigate('/login'); }}>
              退出
            </Button>
          </Space>
        </Header>
        <Content style={{ margin: '24px', minHeight: 'calc(100vh - 112px)' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default AdminLayout;
