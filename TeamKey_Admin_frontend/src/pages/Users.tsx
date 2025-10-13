import { Avatar, Card, Input, Space, Table, Tag } from 'antd';
import dayjs from 'dayjs';
import React, { useEffect, useState } from 'react';
import { adminApi } from '../api/client';

const UsersPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{ items: any[]; total: number; page: number; pageSize: number }>({ items: [], total: 0, page: 1, pageSize: 20 });
  const [keyword, setKeyword] = useState('');

  const fetchUsers = async (page = 1, pageSize = 20, search = keyword) => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, page_size: pageSize };
      const trimmed = search.trim();
      if (trimmed) params.keyword = trimmed;
      const { data } = await adminApi.getUsers(params);
      const items = (data.items || []).map((item: any) => ({
        ...item,
        nickname: item.nickname ?? '-',
        openId: item.open_id,
        avatarUrl: item.avatar_url,
        lastLoginAt: item.last_login_at,
        createdAt: item.created_at,
        teamCount: item.team_count ?? 0,
        accountCount: item.account_count ?? 0,
      }));
      setData({ items, total: data.total, page: data.page, pageSize: data.pageSize });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  return (
    <Card
      className="section"
      title="用户管理"
      extra={
        <Input.Search
          placeholder="搜索昵称 / OpenID"
          allowClear
          onSearch={(value) => {
            const trimmed = value.trim();
            setKeyword(trimmed);
            fetchUsers(1, data.pageSize, trimmed);
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
          onChange: (page, pageSize) => fetchUsers(page, pageSize),
        }}
        columns={[
          { title: '用户ID', dataIndex: 'id', width: 80 },
          {
            title: '用户',
            dataIndex: 'nickname',
            render: (_: unknown, record: any) => (
              <Space>
                <Avatar size={32} src={record.avatarUrl} >{(record.nickname || '-').slice(0, 1)}</Avatar>
                <span>{record.nickname || '-'}</span>
              </Space>
            ),
          },
          { title: 'OpenID', dataIndex: 'openId', render: (value: string) => value || '-' },
          {
            title: '团队数',
            dataIndex: 'teamCount',
            render: (value: number) => <Tag color="blue">{value ?? 0}</Tag>,
          },
          {
            title: '账号数',
            dataIndex: 'accountCount',
            render: (value: number) => <Tag>{value ?? 0}</Tag>,
          },
          {
            title: '最近登录',
            dataIndex: 'lastLoginAt',
            render: (value: string | null) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-'),
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

export default UsersPage;
