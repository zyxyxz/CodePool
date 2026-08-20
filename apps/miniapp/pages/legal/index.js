function buildPolicies(config = {}) {
  const operator = config.operatorName || 'CodePool 运营团队';
  const support = config.supportEmail || '请通过小程序“我的”页面联系运营人员';
  const configured = Boolean(config.operatorName && config.supportEmail);
  const version = configured ? '2026-08-17 版本' : '草案 · 上线前需完成主体与客服配置';
  return {
    configured,
    privacy: {
      title: '隐私政策',
      version,
      sections: [
        { title: '运营主体', body: `CodePool 由 ${operator} 提供。我们按照本政策处理与保护你的个人信息；客服与数据权利请求联系方式：${support}。` },
        { title: '我们处理的信息', body: '为完成登录与团队协作，服务会处理微信 OpenID、你主动设置的昵称与头像（包括从相册或相机选取的图片）、团队成员关系、角色权限、操作时间及安全审计元数据。你主动保存的代码、密文与动态验证码密钥会在服务端加密存储。' },
        { title: '处理目的', body: '上述信息仅用于身份识别、跨设备同步、团队权限控制、敏感内容安全访问、临时分享和安全事件追溯。我们不会读取你的通讯录、聊天记录或未经你授权的设备文件。' },
        { title: '敏感内容与剪贴板', body: 'CodePool 默认遮挡动态码与密文。只有在你主动操作时才会显示或复制。复制后内容进入系统剪贴板，可能被其他应用读取，请在使用后及时覆盖。' },
        { title: '保存与共享', body: '数据保存在 CodePool 配置的服务器中。除团队权限范围内的成员、你主动创建的临时分享及法律法规要求外，不向第三方披露。临时分享可能被持有口令的人领取，请谨慎发送。' },
        { title: '你的权利', body: '你可以查看和修改个人昵称、退出登录、清理本地缓存，并可在“我的”页面提交或撤回账号注销申请。完成注销后身份信息会匿名化、会话会失效；必要的脱敏业务与审计记录可能依法保留。' },
        { title: '联系我们', body: `${operator} · ${support}` },
      ],
    },
    terms: {
      title: '用户协议',
      version,
      sections: [
        { title: '协议主体', body: `本服务由 ${operator} 提供。使用 CodePool 即表示你同意本协议及《隐私政策》；客服与投诉联系方式：${support}。` },
        { title: '服务内容', body: 'CodePool 提供团队代码片段、备注、临时密文、动态验证码及成员权限协作能力。具体功能可能随版本更新调整。' },
        { title: '账号与权限', body: '你应妥善保护微信账号、设备与团队邀请。团队所有者和管理员负责正确分配权限；发现成员离职、设备遗失或邀请泄露时，应及时调整权限。' },
        { title: '禁止行为', body: '不得存储或分享违法内容，不得攻击服务、绕过权限、批量抓取数据，也不得未经授权保存他人的账号密钥、个人信息或商业秘密。' },
        { title: '安全责任', body: '加密存储和安全审计不能替代企业自身的密钥轮换、最小权限、离职交接与灾难恢复制度。动态验证码和临时分享具有时效性，请仅在可信环境中使用。' },
        { title: '服务变更与终止', body: '涉及重大功能或数据处理方式变化时，我们会通过合理方式通知。用户可在个人页提交或撤回注销申请；有其他有效成员的团队应先完成所有权交接，个人团队会在注销完成时停用归档。' },
        { title: '联系我们', body: `${operator} · ${support}` },
      ],
    },
  };
}

Page({
  data: {
    policy: buildPolicies().privacy,
    needsLegalConfig: true,
  },

  onLoad(options) {
    this.policyType = options.type === 'terms' ? 'terms' : 'privacy';
    this.applyConfig(getApp().globalData.publicConfig || {});
    getApp().refreshPublicConfig(true).then((config) => this.applyConfig(config));
  },

  applyConfig(config) {
    const policies = buildPolicies(config);
    const policy = policies[this.policyType] || policies.privacy;
    this.setData({ policy, needsLegalConfig: !policies.configured });
    wx.setNavigationBarTitle({ title: policy.title });
  },
});
