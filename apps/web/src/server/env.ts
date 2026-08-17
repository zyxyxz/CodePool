import path from "node:path";

const isProduction = process.env.NODE_ENV === "production";
const isProductionBuild = process.env.NEXT_PHASE === "phase-production-build";

function secret(name: string, developmentFallback: string, maxLength = 4_096) {
  const value = process.env[name];
  const unsafe = value === developmentFallback || /^(replace-with|change-me|codepool-(development|dev-only))/i.test(value || "") || new Set(value || "").size < 8;
  if (value && value.length >= 24 && value.length <= maxLength && (!isProduction || isProductionBuild || !unsafe)) return value;
  if (isProduction && !isProductionBuild) {
    throw new Error(`${name} must contain 24-${maxLength} non-placeholder characters`);
  }
  return developmentFallback;
}

function requiredProductionValue(name: string, developmentFallback: string) {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (isProduction && !isProductionBuild) {
    throw new Error(`${name} must be configured in production`);
  }
  return developmentFallback;
}

function adminEmail() {
  const value = requiredProductionValue("CODEPOOL_ADMIN_EMAIL", "admin@codepool.local");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error("CODEPOOL_ADMIN_EMAIL must be a valid email address");
  }
  return value;
}

const configuredPath = process.env.CODEPOOL_DATABASE_PATH || "./data/codepool.db";
const jwtSecret = secret("CODEPOOL_JWT_SECRET", "codepool-development-jwt-secret-only");
const masterKey = secret("CODEPOOL_MASTER_KEY", "codepool-development-master-key-only");
const configuredAdminPassword = secret("CODEPOOL_ADMIN_PASSWORD", "codepool-dev-only", 256);

if (isProduction && !isProductionBuild && new Set([jwtSecret, masterKey, configuredAdminPassword]).size !== 3) {
  throw new Error("CODEPOOL_JWT_SECRET, CODEPOOL_MASTER_KEY and CODEPOOL_ADMIN_PASSWORD must be independent values");
}

export const env = {
  isProduction,
  databasePath: path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), configuredPath),
  jwtSecret,
  masterKey,
  adminEmail: adminEmail(),
  adminPassword: configuredAdminPassword,
  wechatAppId: process.env.WECHAT_APP_ID || "",
  wechatAppSecret: process.env.WECHAT_APP_SECRET || "",
  wechatMockLogin: !isProduction && process.env.WECHAT_MOCK_LOGIN !== "false",
};
