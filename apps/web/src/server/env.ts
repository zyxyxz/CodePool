import path from "node:path";

const isProduction = process.env.NODE_ENV === "production";
const isProductionBuild = process.env.NEXT_PHASE === "phase-production-build";

function secret(name: string, developmentFallback: string) {
  const value = process.env[name];
  if (value && value.length >= 24) return value;
  if (isProduction && !isProductionBuild) {
    throw new Error(`${name} must be configured with at least 24 characters`);
  }
  return developmentFallback;
}

const configuredPath = process.env.CODEPOOL_DATABASE_PATH || "./data/codepool.db";

export const env = {
  isProduction,
  databasePath: path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), configuredPath),
  jwtSecret: secret("CODEPOOL_JWT_SECRET", "codepool-development-jwt-secret-only"),
  masterKey: secret("CODEPOOL_MASTER_KEY", "codepool-development-master-key-only"),
  adminEmail: process.env.CODEPOOL_ADMIN_EMAIL || "admin@codepool.local",
  adminPassword: process.env.CODEPOOL_ADMIN_PASSWORD || "codepool-dev-only",
  wechatAppId: process.env.WECHAT_APP_ID || "",
  wechatAppSecret: process.env.WECHAT_APP_SECRET || "",
  wechatMockLogin: !isProduction && process.env.WECHAT_MOCK_LOGIN !== "false",
};
