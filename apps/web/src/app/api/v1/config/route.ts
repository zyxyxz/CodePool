import { getPlatformSettings } from "@/server/admin";
import { fail, ok } from "@/server/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = getPlatformSettings();
    return ok({
      workspaceName: settings.workspaceName,
      operatorName: process.env.CODEPOOL_OPERATOR_NAME || "",
      supportEmail: process.env.CODEPOOL_SUPPORT_EMAIL || settings.supportEmail,
      announcement: settings.announcement,
      maintenanceMode: settings.maintenanceMode,
      allowNewTeams: settings.allowNewTeams,
      allowPublicShares: settings.allowPublicShares,
      allowInvites: settings.allowInvites,
      defaultShareTtlMinutes: settings.defaultShareTtlMinutes,
      maxShareTtlMinutes: settings.maxShareTtlMinutes,
      defaultInviteTtlHours: settings.defaultInviteTtlHours,
      maxShareViews: settings.maxShareViews,
    });
  } catch (error) {
    return fail(error);
  }
}
