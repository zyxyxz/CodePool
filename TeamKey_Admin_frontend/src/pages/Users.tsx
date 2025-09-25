import { Card, Input, Table } from 'antd';
import React, { useEffect, useState } from 'react';
import { adminApi } from '../api/client';

const UsersPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{ items: any[]; total: number; page: number; pageSize: number }>({ items: [], total: 0, page: 1, pageSize: 20 });
  const [keyword, setKeyword] = useState('');

  const fetchUsers = async (page = 1, pageSize = 20, search = keyword) => {
    setLoading(true);
    try {
      const { data } = await adminApi.getUsers({ page, pageSize, keyword: search });
      setData({ items: data.items, total: data.total, page: data.page, pageSize: data.pageSize });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  return (
    <Card className="section" title="用户管理" extra={<Input.Search placeholder="搜索昵称 / OpenID" onSearch={(value) => { setKeyword(value); fetchUsers(1, data.pageSize, value); }} allowClear /> }>
      <Table
        loading={loading}
        dataSource={data.items}
        rowKey="id"
        pagination={{
          current: data.page,
          pageSize: data.pageSize,
          total: data.total,
          onChange: (page, pageSize) => fetchUsers(page, pageSize),
        }}
        columns={[
          { title: '用户ID', dataIndex: 'id' },
          { title: '昵称', dataIndex: 'nickname', render: (value: string) => value || '-' },
          { title: 'OpenID', dataIndex: 'openId' },
          { title: '最近登录', dataIndex: 'lastLoginAt', render: (value: string) => value || '-' },
          { title: '创建时间', dataIndex: 'createdAt' },
        ]}
      />
    </Card>
  );
};

export default UsersPage;
