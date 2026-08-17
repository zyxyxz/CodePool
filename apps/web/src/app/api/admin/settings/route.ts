import type { NextRequest } from "next/server";
import {
  adminAudit,
  adminFail,
  adminOk,
  getPlatformSettings,
  platformSettingsPatchSchema,
  platformSettingsSchema,
  requireAdminRequest,
  savePlatformSettings,
} from "@/server/admin";
import { ApiError, jsonBody } from "@/server/api";
import { db } from "@/server/db";

export async function GET(request: NextRequest) {
  try {
    await requireAdminRequest(request);
    return adminOk(getPlatformSettings());
  } catch (error) {
    return adminFail(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAdminRequest(request, true);
    const patch = platformSettingsPatchSchema.parse(await jsonBody(request));
    const current = getPlatformSettings();
    const settings = platformSettingsSchema.parse({ ...current, ...patch });
    if (settings.defaultShareTtlMinutes > settings.maxShareTtlMinutes) {
      throw new ApiError(422, "默认分享有效期不能超过最大有效期", "INVALID_SHARE_TTL");
    }
    db.transaction(() => {
      savePlatformSettings(settings, session.userId);
      adminAudit(request, session, {
        action: "ADMIN_SETTINGS_UPDATE",
        targetType: "platform_settings",
        targetId: "platform",
        detail: { changedKeys: Object.keys(patch).sort() },
      });
    })();
    return adminOk(settings);
  } catch (error) {
    return adminFail(error);
  }
}
