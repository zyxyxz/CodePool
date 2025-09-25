import { Card, Col, Row, Statistic, Table, Typography } from 'antd';
import React, { useEffect, useState } from 'react';
import { adminApi } from '../api/client';

interface StatsResponse {
  userCount: number;
  teamCount: number;
  accountCount: number;
  membershipCount: number;
}

const { Title } = Typography;

const DashboardPage: React.FC = () => {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    adminApi.getStats().then(({ data }) => setStats(data));
    adminApi.getLogs({ pageSize: 5 }).then(({ data }) => setLogs(data.items || []));
  }, []);

  return (
    <div>
      <div className="page-header">
        <Title level={3}>控制台</Title>
      </div>
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card bordered={false} className="section">
            <Statistic title="用户数" value={stats?.userCount ?? '--'} suffix="人" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card bordered={false} className="section">
            <Statistic title="团队数" value={stats?.teamCount ?? '--'} suffix="个" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card bordered={false} className="section">
            <Statistic title="账号资产" value={stats?.accountCount ?? '--'} suffix="条" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card bordered={false} className="section">
            <Statistic title="成员关系" value={stats?.membershipCount ?? '--'} suffix="条" />
          </Card>
        </Col>
      </Row>

      <Card title="最近操作" className="section" style={{ marginTop: 24 }}>
        <Table
          dataSource={logs}
          pagination={false}
          rowKey="id"
          columns={[
            { title: '时间', dataIndex: 'createdAt', key: 'createdAt' },
            { title: '操作', dataIndex: 'action', key: 'action' },
            {
              title: '用户',
              dataIndex: ['user', 'nickname'],
              key: 'user',
              render: (_: any, record: any) => record.user?.nickname || record.user?.id || '系统',
            },
            { title: '目标', dataIndex: 'targetType', key: 'targetType', render: (_: any, record: any) => `${record.targetType || '--'} #${record.targetId ?? '-'}` },
          ]}
        />
      </Card>
    </div>
  );
};

export default DashboardPage;
