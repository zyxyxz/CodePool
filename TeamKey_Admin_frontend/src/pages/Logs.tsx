import { Card, Col, Input, Row, Table, Tag } from 'antd';
import dayjs from 'dayjs';
import React, { useEffect, useState } from 'react';
import { adminApi } from '../api/client';

const LogsPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [teamId, setTeamId] = useState('');
  const [data, setData] = useState<{ items: any[]; total: number; page: number; pageSize: number }>({ items: [], total: 0, page: 1, pageSize: 20 });

  const fetchLogs = async (page = 1, pageSize = 20, filters?: any) => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, page_size: pageSize, ...filters };
      const trimmedKeyword = keyword.trim();
      const trimmedTeam = teamId.trim();
      if (trimmedKeyword) params.keyword = trimmedKeyword;
      if (trimmedTeam) params.team_id = trimmedTeam;
      const { data } = await adminApi.getLogs(params);
      const items = (data.items || []).map((item: any) => ({
        ...item,
        teamName: item.team_name ?? (item.team_id ? `#${item.team_id}` : '-'),
        userNickname: item.user_nickname ?? item.user_open_id ?? item.user_id,
        createdAt: item.created_at,
        targetType: item.target_type,
        targetId: item.target_id,
      }));
      setData({ items, total: data.total, page: data.page, pageSize: data.pageSize });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  return (
    <Card className="section" title="审计日志">
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
      <Input.Search
        placeholder="搜索动作 / 目标"
        allowClear
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        onSearch={() => fetchLogs(1, data.pageSize)}
      />
        </Col>
        <Col span={12}>
      <Input.Search
        placeholder="团队 ID"
        allowClear
        value={teamId}
        onChange={(e) => setTeamId(e.target.value)}
        onSearch={() => fetchLogs(1, data.pageSize)}
      />
        </Col>
      </Row>
      <Table
        loading={loading}
        dataSource={data.items}
        rowKey="id"
        pagination={{
          current: data.page,
          pageSize: data.pageSize,
          total: data.total,
          onChange: (page, pageSize) => fetchLogs(page, pageSize),
        }}
        columns={[
          {
            title: '时间',
            dataIndex: 'createdAt',
            render: (value: string | null) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-'),
          },
          {
            title: '动作',
            dataIndex: 'action',
            render: (value: string) => <Tag color="geekblue">{value}</Tag>,
          },
          {
            title: '团队',
            dataIndex: 'teamName',
            render: (value: string) => value || '-',
          },
          {
            title: '用户',
            dataIndex: 'userNickname',
            render: (value: string | null) => value || '系统',
          },
          {
            title: '目标',
            dataIndex: 'target_type',
            render: (_: unknown, record: any) => `${record.target_type || record.targetType || '-'} #${record.target_id ?? record.targetId ?? '-'}`,
          },
        ]}
      />
    </Card>
  );
};

export default LogsPage;
