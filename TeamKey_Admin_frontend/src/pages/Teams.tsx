import { Card, Input, Table } from 'antd';
import React, { useEffect, useState } from 'react';
import { adminApi } from '../api/client';

const TeamsPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{ items: any[]; total: number; page: number; pageSize: number }>({ items: [], total: 0, page: 1, pageSize: 20 });
  const [keyword, setKeyword] = useState('');

  const fetchTeams = async (page = 1, pageSize = 20, search = keyword) => {
    setLoading(true);
    try {
      const { data } = await adminApi.getTeams({ page, pageSize, keyword: search });
      setData({ items: data.items, total: data.total, page: data.page, pageSize: data.pageSize });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTeams();
  }, []);

  return (
    <Card className="section" title="团队管理" extra={<Input.Search placeholder="搜索团队" allowClear onSearch={(value) => { setKeyword(value); fetchTeams(1, data.pageSize, value); }} /> }>
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
          { title: '团队ID', dataIndex: 'id' },
          { title: '名称', dataIndex: 'name' },
          { title: '创建时间', dataIndex: 'createdAt' },
          { title: '所有者', dataIndex: ['owner', 'nickname'], render: (_: any, record: any) => record.owner?.nickname || record.owner?.id },
          { title: '描述', dataIndex: 'description', render: (value: string) => value || '-' },
        ]}
      />
    </Card>
  );
};

export default TeamsPage;
