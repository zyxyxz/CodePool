import fs from "node:fs";
import type { NextRequest } from "next/server";
import { adminFail, adminOk, getPlatformSettings, requireAdminRequest } from "@/server/admin";
import { db } from "@/server/db";
import { env } from "@/server/env";

type CheckStatus = "pass" | "warning" | "fail";

export async function GET(request: NextRequest) {
  try {
    await requireAdminRequest(request);
    const journalMode = String((db.pragma("journal_mode", { simple: true }) as string | undefined) || "unknown").toLowerCase();
    const quickCheck = db.pragma("quick_check(1)") as Array<Record<string, unknown>>;
    const integrityValue = String(quickCheck[0]?.quick_check || Object.values(quickCheck[0] || {})[0] || "unknown");
    const integrityOk = integrityValue.toLowerCase() === "ok";
    const schemaVersion = (db.prepare("SELECT COALESCE(MAX(version), 0) AS value FROM schema_migrations").get() as { value: number }).value;
    const databaseSize = fs.existsSync(env.databasePath) ? fs.statSync(env.databasePath).size : 0;
    const wechatConfigured = Boolean(process.env.WECHAT_APP_ID && process.env.WECHAT_APP_SECRET);
    const secretsConfigured = Boolean(
      process.env.CODEPOOL_JWT_SECRET &&
      process.env.CODEPOOL_JWT_SECRET.length >= 24 &&
      process.env.CODEPOOL_MASTER_KEY &&
      process.env.CODEPOOL_MASTER_KEY.length >= 24,
    );
    const adminCredentialsConfigured = Boolean(
      process.env.CODEPOOL_ADMIN_EMAIL &&
      process.env.CODEPOOL_ADMIN_PASSWORD &&
      process.env.CODEPOOL_ADMIN_PASSWORD.length >= 24 &&
      process.env.CODEPOOL_ADMIN_PASSWORD.length <= 256,
    );
    const publicUrl = process.env.NEXT_PUBLIC_APP_URL || "";
    const httpsConfigured = publicUrl.startsWith("https://");
    const settings = getPlatformSettings();
    const supportEmail = process.env.CODEPOOL_SUPPORT_EMAIL || settings.supportEmail;
    const legalIdentityConfigured = Boolean(process.env.CODEPOOL_OPERATOR_NAME && supportEmail);

    const securityChecks: Array<{
      key: string;
      label: string;
      status: "healthy" | "warning";
      severity: CheckStatus;
      detail: string;
    }> = [
      {
        key: "database-integrity",
        label: "数据库完整性",
        status: integrityOk ? "healthy" : "warning",
        severity: integrityOk ? "pass" : "fail",
        detail: integrityOk ? "SQLite quick_check 正常。" : "SQLite 完整性检查失败，请立即停止写入并恢复备份。",
      },
      {
        key: "database-wal",
        label: "数据库并发模式",
        status: journalMode === "wal" ? "healthy" : "warning",
        severity: journalMode === "wal" ? "pass" : "warning",
        detail: journalMode === "wal" ? "SQLite WAL 已启用。" : `当前 journal_mode 为 ${journalMode}。`,
      },
      {
        key: "application-secrets",
        label: "应用密钥",
        status: secretsConfigured ? "healthy" : "warning",
        severity: secretsConfigured ? "pass" : "fail",
        detail: secretsConfigured ? "JWT 与数据加密密钥已通过环境变量配置。" : "生产环境必须配置独立的 JWT 与数据加密密钥。",
      },
      {
        key: "admin-credentials",
        label: "管理员凭据",
        status: adminCredentialsConfigured ? "healthy" : "warning",
        severity: adminCredentialsConfigured ? "pass" : "warning",
        detail: adminCredentialsConfigured ? "管理员凭据已通过环境变量配置。" : "请配置管理员邮箱和至少 24 位的强密码。",
      },
      {
        key: "https",
        label: "公网 HTTPS",
        status: httpsConfigured ? "healthy" : "warning",
        severity: httpsConfigured ? "pass" : "warning",
        detail: httpsConfigured ? "公网地址使用 HTTPS。" : "NEXT_PUBLIC_APP_URL 未配置为 HTTPS 地址。",
      },
      {
        key: "wechat",
        label: "微信小程序登录",
        status: wechatConfigured ? "healthy" : "warning",
        severity: wechatConfigured ? "pass" : "fail",
        detail: wechatConfigured ? "微信 AppID 与 AppSecret 已配置。" : "缺少 WECHAT_APP_ID 或 WECHAT_APP_SECRET。",
      },
      {
        key: "legal-identity",
        label: "运营主体与客服",
        status: legalIdentityConfigured ? "healthy" : "warning",
        severity: legalIdentityConfigured ? "pass" : "fail",
        detail: legalIdentityConfigured ? "隐私政策已关联正式运营主体和客服邮箱。" : "正式发布前请配置 CODEPOOL_OPERATOR_NAME，并在运营策略中填写客服邮箱。",
      },
      {
        key: "backup",
        label: "数据库备份",
        status: "warning",
        severity: "warning",
        detail: "应用暂不掌握 Dokploy 持久卷的备份状态，请在基础设施侧配置定时快照并演练恢复。",
      },
    ];
    const health = integrityOk ? (securityChecks.some((check) => check.severity === "fail") ? "degraded" : "healthy") : "unhealthy";
    return adminOk({
      service: {
        status: integrityOk ? "ok" : "error",
        health,
        version: process.env.npm_package_version || "0.3.0",
        nodeVersion: process.version,
        environment: env.isProduction ? "production" : "development",
        uptimeSeconds: Math.floor(process.uptime()),
        memoryRssBytes: process.memoryUsage().rss,
        checkedAt: new Date().toISOString(),
      },
      database: {
        engine: "sqlite",
        path: env.databasePath,
        sizeBytes: databaseSize,
        journalMode,
        integrityOk,
        schemaVersion,
        lastBackupAt: null,
      },
      configuration: {
        wechatConfigured,
        secretsConfigured,
        adminCredentialsConfigured,
        publicUrl,
        httpsConfigured,
        mockWechatLogin: env.wechatMockLogin,
        legalIdentityConfigured,
      },
      securityChecks,
    });
  } catch (error) {
    return adminFail(error);
  }
}
