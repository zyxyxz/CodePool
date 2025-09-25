import { Card, Input, Table } from 'antd';
import React, { useEffect, useState } from 'react';
import { adminApi } from '../api/client';

const AccountsPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [teamId, setTeamId] = useState<string>('');
  const [data, setData] = useState<{ items: any[]; total: number; page: number; pageSize: number }>({ items: [], total: 0, page: 1, pageSize: 20 });

  const fetchAccounts = async (page = 1, pageSize = 20, team = teamId) => {
    setLoading(true);
    try {
      const params: any = { page, pageSize };
      if (team) params.teamId = team;
      const { data } = await adminApi.getAccounts(params);
      setData({ items: data.items, total: data.total, page: data.page, pageSize: data.pageSize });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  return (
    <Card
      className="section"
      title="账号资产"
      extra={
        <Input.Search
          style={{ width: 200 }}
          placeholder="过滤团队 ID"
          allowClear
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          onSearch={(value) => {
            setTeamId(value);
            fetchAccounts(1, data.pageSize, value);
          }}
        />
      }
    >
      <Table
        loading={loading}
        dataSource={data.items}
        rowKey="id"
        pagination={{
          current: data.page,
          pageSize: data.pageSize,
          total: data.total,
          onChange: (page, pageSize) => fetchAccounts(page, pageSize),
        }}
        columns={[
          { title: '账号ID', dataIndex: 'id' },
          { title: '团队', dataIndex: ['team', 'name'], render: (_: any, record: any) => record.team?.name || `#${record.team?.id}` },
          { title: '服务', dataIndex: 'issuer' },
          { title: '标签', dataIndex: 'label' },
          { title: '创建人', dataIndex: ['createdBy', 'nickname'], render: (_: any, record: any) => record.createdBy?.nickname || record.createdBy?.id },
          { title: '创建时间', dataIndex: 'createdAt' },
        ]}
      />
    </Card>
  );
};

export default AccountsPage;
