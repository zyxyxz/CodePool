import { Button, Card, Form, Input, Switch, Typography, message } from 'antd';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '../api/client';
import { useAuth } from '../context/AuthContext';

const { Title, Paragraph } = Typography;

const BootstrapPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login, token, profile } = useAuth();

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      await adminApi.bootstrap(values);
      message.success('初始化完成');
      if (token) {
        login(token, { email: values.adminEmail || profile?.email || 'admin', installed: true });
      }
      navigate('/dashboard', { replace: true });
    } catch (error: any) {
      message.error(error?.message || '初始化失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
      <Card style={{ width: 720, borderRadius: 24 }}>
        <Title level={3}>TeamKey 初始化向导</Title>
        <Paragraph>配置基本信息后方可开始使用。可根据部署环境补充，后续可在系统设置中修改。</Paragraph>
        <Form layout="vertical"onFinish={onFinish} initialValues={{ markInstalled: true }}>
          <Form.Item label="站点 URL" name="siteUrl" rules={[{ required: true, message: '请输入站点地址' }]}>
            <Input placeholder="https://teamkey.example.com" />
          </Form.Item>
          <Form.Item label="数据库连接 (可选)" name="dbDsn">
            <Input placeholder="sqlite://data/teamkey.db" />
          </Form.Item>
          <Form.Item label="Redis DSN (可选)" name="redisDsn">
            <Input placeholder="redis://127.0.0.1:6379" />
          </Form.Item>
          <Form.Item label="对象存储配置 (JSON)" name="ossConf">
            <Input.TextArea placeholder='{"provider":"s3","bucket":"teamkey"}' rows={3} />
          </Form.Item>
          <Form.Item label="小程序 AppID" name="wxAppId">
            <Input placeholder="wx123..." />
          </Form.Item>
          <Form.Item label="小程序 Secret" name="wxSecret">
            <Input placeholder="secret" />
          </Form.Item>
          <Form.Item label="管理员邮箱" name="adminEmail" rules={[{ required: true, message: '请输入管理员邮箱' }]}>
            <Input placeholder="admin@teamkey.local" />
          </Form.Item>
          <Form.Item label="管理员密码" name="adminPassword" rules={[{ required: true, message: '请输入管理员密码' }]}>
            <Input.Password placeholder="至少 8 位" />
          </Form.Item>
          <Form.Item label="初始化后标记为已安装" name="markInstalled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} size="large">
              完成初始化
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default BootstrapPage;
