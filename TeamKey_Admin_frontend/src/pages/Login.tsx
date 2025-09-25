import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { Button, Card, Form, Input, Typography, message } from 'antd';
import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { adminApi } from '../api/client';
import { useAuth } from '../context/AuthContext';

const { Title, Paragraph } = Typography;

const LoginPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as any)?.from?.pathname || '/dashboard';

  const onFinish = async (values: { email: string; password: string }) => {
    setLoading(true);
    try {
      const { data } = await adminApi.login(values);
      login(data.token, data.profile);
      message.success('登录成功');
      if (data.profile.installed) {
        navigate(from, { replace: true });
      } else {
        navigate('/bootstrap', { replace: true });
      }
    } catch (error: any) {
      message.error(error?.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'linear-gradient(135deg,#1A237E,#4527A0)' }}>
      <Card style={{ width: 360, borderRadius: 24 }}>
        <Title level={3} style={{ textAlign: 'center' }}>
          TeamKey 管理后台
        </Title>
        <Paragraph style={{ textAlign: 'center', color: '#6b7280' }}>使用管理员凭据登录</Paragraph>
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item name="email" label="邮箱" rules={[{ required: true, message: '请输入邮箱' }]}> 
            <Input size="large" prefix={<MailOutlined />} placeholder="admin@teamkey.local" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}> 
            <Input.Password size="large" prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block size="large" loading={loading}>
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default LoginPage;
