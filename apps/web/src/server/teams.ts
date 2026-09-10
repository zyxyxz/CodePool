import "server-only";

import { z } from "zod";

export const TEAM_THEME_COLORS = ["#15803D", "#2563EB", "#7C3AED", "#DB2777", "#EA580C", "#0891B2"] as const;
export const DEFAULT_TEAM_THEME_COLOR = TEAM_THEME_COLORS[0];
export const teamNameSchema = z.string().trim().min(2).max(48);
export const teamThemeColorSchema = z.enum(TEAM_THEME_COLORS);
