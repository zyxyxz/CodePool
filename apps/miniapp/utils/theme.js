const TEAM_COLORS = ['#15803D', '#2563EB', '#7C3AED', '#DB2777', '#EA580C', '#0891B2'];

function normalizeThemeColor(value) {
  const color = typeof value === 'string' ? value.toUpperCase() : '';
  return TEAM_COLORS.includes(color) ? color : TEAM_COLORS[0];
}

module.exports = { TEAM_COLORS, normalizeThemeColor };
