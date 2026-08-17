import Link from "next/link";

const capabilities = [
  { index: "01", title: "代码片段", text: "沉淀脚本、配置和常用命令，按团队池统一管理。" },
  { index: "02", title: "动态验证码", text: "服务端即时计算 TOTP，密钥加密保存且不写入日志。" },
  { index: "03", title: "临时密文", text: "一次性验证码和敏感文本支持过期时间与限次领取。" },
  { index: "04", title: "可追溯协作", text: "角色、邀请、分享和查看都进入不可见敏感值的审计流。" },
];

export default function Home() {
  return (
    <main className="landing">
      <nav className="site-nav shell">
        <Link href="/" className="brand"><span className="brand-mark">C</span><span>CodePool</span></Link>
        <div className="nav-actions"><a href="#architecture">技术架构</a><Link className="button ghost small" href="/admin">管理控制台</Link></div>
      </nav>

      <section className="hero shell">
        <div className="eyebrow"><span className="pulse" /> TEAM KNOWLEDGE, SECURELY SHARED</div>
        <h1>把团队常用的代码与<br /><em>验证码，放进一个池里。</em></h1>
        <p className="hero-copy">CodePool 是面向小团队的轻量安全协作空间。用微信小程序随手取用，用统一控制台管理权限、内容和审计。</p>
        <div className="hero-actions"><Link className="button primary" href="/admin">进入控制台 <span>↗</span></Link><a className="button text" href="#capabilities">了解能力 ↓</a></div>
        <div className="terminal-card" aria-label="CodePool 示例">
          <div className="terminal-top"><span /><span /><span /><b>codepool / production</b></div>
          <div className="terminal-body">
            <div className="tree"><span className="muted">POOL</span><strong>产品研发组</strong><span>├─ deploy.sh</span><span>├─ Cloudflare · TOTP</span><span>├─ 测试环境验证码</span><span>└─ 数据库只读凭据</span></div>
            <div className="code-preview"><span className="tag">TOTP · 18s</span><strong>482&nbsp;917</strong><p>Cloudflare / ops@codepool.dev</p><div className="meter"><i /></div></div>
          </div>
        </div>
      </section>

      <section className="capabilities shell" id="capabilities">
        <div className="section-heading"><span>BUILT FOR SMALL TEAMS</span><h2>一个模型，容纳多种共享内容</h2></div>
        <div className="capability-grid">{capabilities.map((item) => <article key={item.index}><span>{item.index}</span><h3>{item.title}</h3><p>{item.text}</p></article>)}</div>
      </section>

      <section className="architecture shell" id="architecture">
        <div><span className="kicker">ONE TYPESCRIPT STACK</span><h2>更少的边界，<br />更可靠的交付。</h2><p>页面、管理端和 API Route Handlers 统一在 Next.js；微信小程序保持原生，直接消费版本化 API。</p></div>
        <div className="architecture-map"><div><small>CLIENT</small><b>微信原生小程序</b></div><i>HTTPS / JWT</i><div className="active"><small>FULL STACK</small><b>Next.js App Router</b><span>Web · Admin · API</span></div><i>encrypted at rest</i><div><small>DATA</small><b>SQLite → PostgreSQL</b></div></div>
      </section>
      <footer className="shell"><div className="brand"><span className="brand-mark">C</span><span>CodePool</span></div><p>代码需要流动，秘密需要边界。</p></footer>
    </main>
  );
}
