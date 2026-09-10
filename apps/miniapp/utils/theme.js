const TEAM_COLORS = ['#15803D', '#2563EB', '#7C3AED', '#DB2777', '#EA580C', '#0891B2'];

// Persisted team colors remain stable; presentation uses softer, accessible tones.
const PALETTES = [
  { key: 'sage', label: '鼠尾草', accent: '#426B5A', ink: '#273B32', bg: '#F5F7F2', tint: '#E7EFE5', border: '#D9E4D7', heroStart: '#E3EDDF', heroEnd: '#F4EADF' },
  { key: 'blue', label: '雾霭蓝', accent: '#48658A', ink: '#29394D', bg: '#F3F6FA', tint: '#E6EDF7', border: '#D8E1EE', heroStart: '#DFE8F5', heroEnd: '#F0EBF4' },
  { key: 'lilac', label: '香芋紫', accent: '#725982', ink: '#423449', bg: '#F8F4F9', tint: '#EFE5F3', border: '#E5D9E9', heroStart: '#EBDFF1', heroEnd: '#F5E9E4' },
  { key: 'rose', label: '蔷薇粉', accent: '#875367', ink: '#4A333E', bg: '#FBF4F6', tint: '#F5E4EA', border: '#EED8E1', heroStart: '#F2DFE6', heroEnd: '#F7EDDD' },
  { key: 'peach', label: '杏仁桃', accent: '#8C5935', ink: '#4B382C', bg: '#FCF7F1', tint: '#F8EBD8', border: '#EEDFCB', heroStart: '#F4E4CB', heroEnd: '#F7E8E6' },
  { key: 'teal', label: '薄荷青', accent: '#376B6F', ink: '#293E40', bg: '#F1F8F7', tint: '#DEEEEB', border: '#D1E5E1', heroStart: '#D8EBE6', heroEnd: '#F1EFDE' },
];

function normalizeThemeColor(value) {
  const color = typeof value === 'string' ? value.toUpperCase() : '';
  return TEAM_COLORS.includes(color) ? color : TEAM_COLORS[0];
}

function getTheme(color) {
  const normalized = normalizeThemeColor(color);
  return { ...PALETTES[TEAM_COLORS.indexOf(normalized)], color: normalized, surface: '#FFFDFA', muted: '#62655F' };
}

function getThemeStyle(color) {
  const theme = getTheme(color);
  return [
    ['bg', theme.bg], ['surface', theme.surface], ['ink', theme.ink],
    ['muted', theme.muted], ['accent', theme.accent], ['tint', theme.tint],
    ['border', theme.border], ['hero-start', theme.heroStart], ['hero-end', theme.heroEnd],
    ['accent-soft', theme.tint],
  ].map(([name, value]) => `--cp-${name}:${value}`).join(';');
}

function getThemeData(color) {
  return { theme: getTheme(color), themeStyle: getThemeStyle(color) };
}

function getActiveThemeColor(application) {
  const app = application || (typeof getApp === 'function' ? getApp() : null);
  const data = app && app.globalData || {};
  const team = (data.teams || []).find((entry) => entry.teamId === data.activeTeamId);
  return normalizeThemeColor(team ? team.themeColor : data.activeThemeColor);
}

function applyPageTheme(page, color) {
  const themeData = getThemeData(color === undefined ? getActiveThemeColor() : color);
  page.setData(themeData);
  // A delayed response from a hidden page must never recolor the visible page.
  if (typeof getCurrentPages === 'function') {
    const pages = getCurrentPages();
    if (pages.length && pages[pages.length - 1] !== page) return themeData.theme;
  }
  const theme = themeData.theme;
  const call = (name, options) => {
    if (typeof wx !== 'undefined' && typeof wx[name] === 'function') {
      wx[name]({ ...options, fail: () => {} });
    }
  };
  call('setNavigationBarColor', { frontColor: '#000000', backgroundColor: theme.bg });
  call('setBackgroundColor', { backgroundColor: theme.bg, backgroundColorTop: theme.bg, backgroundColorBottom: theme.bg });
  call('setBackgroundTextStyle', { textStyle: 'dark' });
  call('setTabBarStyle', { color: theme.muted, selectedColor: theme.accent, backgroundColor: theme.surface, borderStyle: 'white' });
  ['home', 'team', 'logs', 'profile'].forEach((name, index) => {
    call('setTabBarItem', { index, selectedIconPath: `assets/icons/themes/${theme.key}/${name}-active.png` });
  });
  return theme;
}

module.exports = { TEAM_COLORS, normalizeThemeColor, getTheme, getThemeStyle, getThemeData, getActiveThemeColor, applyPageTheme };
