import { Button, Card, Form, Input, message } from 'antd';
import React, { useEffect, useState } from 'react';
import { adminApi } from '../api/client';

const SettingsPage: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.getSettings();
      form.setFieldsValue({
        siteUrl: data.siteUrl,
        dbDsn: data.dbDsn,
        redisDsn: data.redisDsn,
        ossConf: data.ossConf ? JSON.stringify(data.ossConf, null, 2) : '',
        wxAppId: data.wxAppId,
        adminEmail: data.adminEmail,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSubmit = async (values: any) => {
    setLoading(true);
    try {
      await adminApi.updateSettings(values);
      message.success('设置已保存');
    } catch (error: any) {
      message.error(error?.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="section" title="系统设置">
      <Form layout="vertical" form={form} onFinish={handleSubmit}>
        <Form.Item label="站点 URL" name="siteUrl">
          <Input placeholder="https://teamkey.example.com" />
        </Form.Item>
        <Form.Item label="数据库 DSN" name="dbDsn">
          <Input placeholder="sqlite://data/teamkey.db" />
        </Form.Item>
        <Form.Item label="Redis DSN" name="redisDsn">
          <Input placeholder="redis://127.0.0.1:6379" />
        </Form.Item>
        <Form.Item label="对象存储配置 (JSON)" name="ossConf">
          <Input.TextArea rows={4} placeholder='{"provider":"s3"}' />
        </Form.Item>
        <Form.Item label="小程序 AppID" name="wxAppId">
          <Input />
        </Form.Item>
        <Form.Item label="小程序 Secret" name="wxSecret">
          <Input.Password placeholder="留空则保持不变" />
        </Form.Item>
        <Form.Item label="管理员邮箱" name="adminEmail">
          <Input />
        </Form.Item>
        <Form.Item label="管理员密码" name="adminPassword">
          <Input.Password placeholder="留空则不修改" />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={loading}>
            保存设置
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
};

export default SettingsPage;
