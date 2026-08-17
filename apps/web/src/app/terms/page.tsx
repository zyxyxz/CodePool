import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "用户协议" };
export const dynamic = "force-dynamic";

export default function TermsPage() {
  const operator = process.env.CODEPOOL_OPERATOR_NAME || "CodePool 运营团队";
  return <main className="legal-page"><header><Link href="/" className="brand"><span className="brand-mark">C</span><span>CodePool</span></Link><Link href="/">返回首页</Link></header><article><span className="kicker">TERMS OF SERVICE</span><h1>CodePool 用户协议</h1><p className="legal-meta">更新日期：2026 年 8 月 17 日 · 生效日期：正式发布之日</p><p>欢迎使用由 {operator} 提供的 CodePool。使用服务即表示您同意遵守本协议及《隐私政策》。</p><h2>一、服务范围</h2><p>CodePool 提供团队代码片段、动态验证码、临时口令、密文和备注的共享、权限管理及安全审计。它不是完整密码管理器、代码托管服务或绝对安全的离线保管工具。</p><h2>二、账号与权限</h2><ul><li>您应妥善保护微信账号、设备和团队邀请，不得出借或共享登录状态。</li><li>团队所有者和管理员负责配置成员角色，并确保成员仅访问工作所需内容。</li><li>运营方可以在发现滥用、安全风险或违法行为时停用账号、团队、内容、分享或邀请。</li></ul><h2>三、内容规范</h2><p>您不得存储或传播违法信息、恶意代码、窃取所得凭据、侵害他人权益的内容，或利用服务攻击、绕过其他系统。您应确保拥有处理和共享相关内容的合法权限。</p><h2>四、敏感内容提示</h2><p>服务采用“服务端可信”加密模型，不构成零知识或端到端加密。请勿保存网站主密码、个人完整密码库或一旦泄露将产生不可接受后果的根密钥。复制到系统剪贴板后的内容由设备系统管理，请及时清除。</p><h2>五、可用性与变更</h2><p>我们会尽力保持服务可用并做好备份，但网络、基础设施、第三方平台或维护可能造成中断。涉及重大功能或规则变更时，我们会通过合理方式通知。</p><h2>六、终止与注销</h2><p>您可以在小程序提交注销申请。若仍拥有活跃团队，需要先转移团队所有权或完成团队处置。注销后的数据处理方式以《隐私政策》为准。</p><h2>七、责任边界</h2><p>因用户越权分享、设备失控、第三方账号被盗、违反使用规范或未妥善保存恢复材料造成的损失，由责任方依法承担。法律另有强制规定的，从其规定。</p><footer><Link href="/privacy">《隐私政策》</Link><span>·</span><Link href="/">CodePool 首页</Link></footer></article></main>;
}
