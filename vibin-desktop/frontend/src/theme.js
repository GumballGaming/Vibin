export const themes = {
  warm: { name: "Warm Clay", description: "Soft cream and terracotta.", colors: ["#f7eee6", "#fff8f1", "#b46a46"], vars: { bg: "#f7eee6", surface: "#fff8f1", "surface-warm": "#ead6c7", fg: "#2b211c", "fg-2": "#5a4b43", muted: "#8a7a70", meta: "#b46a46", border: "#dac8b9", "border-soft": "#eaded4", accent: "#b46a46", "accent-on": "#ffffff" } },
  dusk: { name: "Dusk", description: "Charcoal with lavender.", colors: ["#191821", "#24222e", "#a998e8"], vars: { bg: "#191821", surface: "#24222e", "surface-warm": "#302d3d", fg: "#f0edf7", "fg-2": "#cbc5d8", muted: "#928ba3", meta: "#a998e8", border: "#413d50", "border-soft": "#312e3c", accent: "#a998e8", "accent-on": "#17151d" } },
  forest: { name: "Forest", description: "Evergreen with fresh mint.", colors: ["#12201c", "#1a2b25", "#74c69d"], vars: { bg: "#12201c", surface: "#1a2b25", "surface-warm": "#253a32", fg: "#eef8f2", "fg-2": "#c4d8cc", muted: "#87a195", meta: "#74c69d", border: "#345044", "border-soft": "#263c33", accent: "#74c69d", "accent-on": "#102018" } },
  ocean: { name: "Ocean", description: "Navy with crisp sky blue.", colors: ["#101b2b", "#17263a", "#67b7dc"], vars: { bg: "#101b2b", surface: "#17263a", "surface-warm": "#20344d", fg: "#edf6fb", "fg-2": "#c1d3df", muted: "#8099aa", meta: "#67b7dc", border: "#304b66", "border-soft": "#21374f", accent: "#67b7dc", "accent-on": "#0d1b26" } }
};

export function getTheme() {
  const saved = localStorage.getItem("vibin.theme");
  return saved && themes[saved] ? saved : "warm";
}

export function applyTheme(id) {
  const selected = themes[id] ? id : "warm";
  document.documentElement.dataset.theme = selected;
  Object.entries(themes[selected].vars).forEach(([key, value]) => document.documentElement.style.setProperty(`--${key}`, value));
  localStorage.setItem("vibin.theme", selected);
}

applyTheme(getTheme());
