import type { Metadata } from "next";
import Link from "next/link";
import { getPlatformSettings } from "@/server/admin";

export const metadata: Metadata = { title: "隐私政策" };
export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  const operator = process.env.CODEPOOL_OPERATOR_NAME || "CodePool 运营团队";
  const support = process.env.CODEPOOL_SUPPORT_EMAIL || getPlatformSettings().supportEmail || "请通过小程序“我的”页面联系运营人员";
  return <main className="legal-page"><header><Link href="/" className="brand"><span className="brand-mark">C</span><span>CodePool</span></Link><Link href="/">返回首页</Link></header><article><span className="kicker">PRIVACY POLICY</span><h1>CodePool 隐私政策</h1><p className="legal-meta">更新日期：2026 年 8 月 17 日 · 生效日期：正式发布之日</p><p>本政策说明 {operator}（以下简称“我们”）在提供 CodePool 团队协作服务时如何处理个人信息。正式上线前，运营方应在微信公众平台同步配置与本政策一致的隐私保护指引。</p><h2>一、我们处理的信息</h2><ul><li>账号信息：微信 OpenID、可选的 UnionID、昵称和头像，用于识别账号与展示团队成员。</li><li>协作信息：团队关系、角色、内容标题和业务操作记录，用于提供团队共享与权限控制。</li><li>安全信息：登录时间、操作时间，以及经过不可逆摘要处理的网络地址特征，用于防滥用与安全审计。</li><li>用户主动提交的内容：代码片段、动态验证码密钥、临时密文和备注。正文在服务端使用认证加密保存。</li></ul><h2>二、处理目的与方式</h2><p>我们仅为登录认证、团队协作、权限校验、内容加密存储、显式读取、短期分享、安全审计和故障处理而使用相关信息。运营后台不会展示内容正文、TOTP 密钥、微信身份凭据或登录令牌。</p><h2>三、保存期限</h2><p>账号与团队信息在服务存续期间保存；审计记录按照运营后台配置的保留周期保存；到期分享与邀请只保留必要的状态记录。法律法规另有要求时，从其规定。</p><h2>四、共享与对外提供</h2><p>除用户主动创建团队邀请或外部分享外，我们不会出售个人信息。服务依赖微信登录、服务器托管和必要的基础设施服务商；正式发布时应在微信隐私保护指引中列明实际使用的第三方及处理范围。</p><h2>五、您的权利</h2><p>您可以在小程序内查看账号信息、退出登录、提交或撤回注销申请。注销完成后，身份信息会被匿名化、会话会失效；为保证团队协作和审计完整性，已产生的团队业务记录可能以“已注销用户”名义保留。</p><h2>六、信息安全</h2><p>CodePool 使用 HTTPS、访问控制、会话版本、AES-256-GCM 加密、令牌摘要、限流和脱敏审计保护数据。任何安全措施都无法保证绝对安全；发现风险后我们会及时处置并按适用规则通知。</p><h2>七、未成年人</h2><p>本服务面向组织和团队协作，不主动面向未成年人。若发现未经监护人同意处理未成年人信息，我们将依法处置。</p><h2>八、联系我们</h2><p>{support}</p><footer><Link href="/terms">《用户协议》</Link><span>·</span><Link href="/">CodePool 首页</Link></footer></article></main>;
}
