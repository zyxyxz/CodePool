import { Card, Col, Row, Statistic, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
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
    adminApi.getStats().then(({ data }) =>
      setStats({
        userCount: data.user_count,
        teamCount: data.team_count,
        accountCount: data.account_count,
        membershipCount: data.membership_count,
      })
    );
    adminApi
      .getLogs({ page_size: 5 })
      .then(({ data }) =>
        setLogs(
          (data.items || []).map((item: any) => ({
            ...item,
            createdAt: item.created_at,
            teamName: item.team_name ?? (item.team_id ? `#${item.team_id}` : '-'),
            userNickname: item.user_nickname ?? item.user_open_id ?? item.user_id,
            targetType: item.target_type,
            targetId: item.target_id,
          }))
        )
      );
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
            {
              title: '时间',
              dataIndex: 'createdAt',
              key: 'createdAt',
              render: (value: string) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-'),
            },
            {
              title: '操作',
              dataIndex: 'action',
              key: 'action',
              render: (value: string) => <Tag color="geekblue">{value}</Tag>,
            },
            {
              title: '用户',
              dataIndex: 'userNickname',
              key: 'user',
              render: (value: string | null) => value || '系统',
            },
            {
              title: '目标',
              dataIndex: 'targetType',
              key: 'targetType',
              render: (_: unknown, record: any) => `${record.targetType || '--'} #${record.targetId ?? '-'}`,
            },
          ]}
        />
      </Card>
    </div>
  );
};

export default DashboardPage;
