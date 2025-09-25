import { Card, Col, Input, Row, Table } from 'antd';
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
      const params: any = { page, pageSize, keyword, teamId, ...filters };
      if (!params.teamId) delete params.teamId;
      if (!params.keyword) delete params.keyword;
      const { data } = await adminApi.getLogs(params);
      setData({ items: data.items, total: data.total, page: data.page, pageSize: data.pageSize });
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
            placeholder="搜索关键字"
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
          { title: '时间', dataIndex: 'createdAt' },
          { title: '动作', dataIndex: 'action' },
          { title: '团队', dataIndex: ['team', 'name'], render: (_: any, record: any) => record.team?.name || record.team?.id || '-' },
          { title: '用户', dataIndex: ['user', 'nickname'], render: (_: any, record: any) => record.user?.nickname || record.user?.id || '系统' },
          { title: '目标', dataIndex: 'targetType', render: (_: any, record: any) => `${record.targetType || '-'} #${record.targetId ?? '-'}` },
        ]}
      />
    </Card>
  );
};

export default LogsPage;
