import { Card, Input, Table } from 'antd';
import dayjs from 'dayjs';
import React, { useEffect, useState } from 'react';
import { adminApi } from '../api/client';

const AccountsPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [teamId, setTeamId] = useState<string>('');
  const [data, setData] = useState<{ items: any[]; total: number; page: number; pageSize: number }>({ items: [], total: 0, page: 1, pageSize: 20 });

  const fetchAccounts = async (page = 1, pageSize = 20, team = teamId) => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, page_size: pageSize };
      const normalizedTeam = typeof team === 'string' ? team.trim() : team;
      if (normalizedTeam) params.team_id = normalizedTeam;
      const { data } = await adminApi.getAccounts(params);
      const items = (data.items || []).map((item: any) => ({
        ...item,
        teamName: item.team_name ?? item.team?.name ?? (item.team_id ? `#${item.team_id}` : '-'),
        createdByName:
          item.created_by_nickname ??
          item.createdBy?.nickname ??
          (item.created_by_id ?? item.createdBy?.id ?? '-'),
        createdAt: item.created_at ?? item.createdAt,
        accountIdentifier: item.account_identifier ?? item.accountIdentifier,
        remark: item.remark ?? item.extra_metadata?.remark,
      }));
      setData({ items, total: data.total, page: data.page, pageSize: data.pageSize });
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
            const trimmed = value.trim();
            setTeamId(trimmed);
            fetchAccounts(1, data.pageSize, trimmed);
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
          { title: '账号ID', dataIndex: 'id', width: 80 },
          {
            title: '团队',
            dataIndex: 'teamName',
            render: (_: unknown, record: any) => record.teamName || '-',
          },
          { title: '服务', dataIndex: 'issuer' },
          { title: '标签', dataIndex: 'label' },
          {
            title: '备注',
            dataIndex: 'remark',
            render: (value: string | null) => value || '-',
          },
          {
            title: '账号标识',
            dataIndex: 'accountIdentifier',
            render: (value: string | null) => value || '-',
          },
          {
            title: '创建人',
            dataIndex: 'createdByName',
            render: (_: unknown, record: any) => record.createdByName || '-',
          },
          {
            title: '创建时间',
            dataIndex: 'createdAt',
            render: (value: string | null) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-'),
          },
        ]}
      />
    </Card>
  );
};

export default AccountsPage;
