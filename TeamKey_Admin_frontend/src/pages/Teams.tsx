import { Card, Input, Table, Tag } from 'antd';
import dayjs from 'dayjs';
import React, { useEffect, useState } from 'react';
import { adminApi } from '../api/client';

const TeamsPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{ items: any[]; total: number; page: number; pageSize: number }>({ items: [], total: 0, page: 1, pageSize: 20 });
  const [keyword, setKeyword] = useState('');

  const fetchTeams = async (page = 1, pageSize = 20, search = keyword) => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, page_size: pageSize };
      const trimmed = search.trim();
      if (trimmed) params.keyword = trimmed;
      const { data } = await adminApi.getTeams(params);
      const items = (data.items || []).map((item: any) => ({
        ...item,
        ownerNickname: item.owner_nickname,
        ownerOpenId: item.owner_open_id,
        memberCount: item.member_count ?? 0,
        createdAt: item.created_at,
      }));
      setData({ items, total: data.total, page: data.page, pageSize: data.pageSize });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTeams();
  }, []);

  return (
    <Card
      className="section"
      title="团队管理"
      extra={
        <Input.Search
          placeholder="搜索团队"
          allowClear
          onSearch={(value) => {
            const trimmed = value.trim();
            setKeyword(trimmed);
            fetchTeams(1, data.pageSize, trimmed);
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
          onChange: (page, pageSize) => fetchTeams(page, pageSize),
        }}
        columns={[
          { title: '团队ID', dataIndex: 'id', width: 90 },
          { title: '名称', dataIndex: 'name' },
          {
            title: '成员数',
            dataIndex: 'memberCount',
            render: (value: number) => <Tag color="blue">{value ?? 0}</Tag>,
          },
          {
            title: '所有者',
            dataIndex: 'ownerNickname',
            render: (_: unknown, record: any) => record.ownerNickname || record.ownerOpenId || record.owner_id || '-',
          },
          {
            title: '创建时间',
            dataIndex: 'createdAt',
            render: (value: string | null) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-'),
          },
          { title: '描述', dataIndex: 'description', render: (value: string) => value || '-' },
        ]}
      />
    </Card>
  );
};

export default TeamsPage;
