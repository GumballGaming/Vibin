import { applyTheme, getTheme, themes } from "./theme.js";

function renderThemes(grid) {
  const active = getTheme();
  grid.innerHTML = Object.entries(themes)
    .map(
      ([id, theme]) => `
    <button class="theme-card${id === active ? " active" : ""}" data-theme="${id}" aria-pressed="${id === active}">
      <span class="preview" style="background:linear-gradient(135deg, ${theme.colors[0]}, ${theme.colors[2]})"></span>
      <span class="copy"><strong>${theme.name}</strong><small>${theme.description}</small></span>
      <span class="check">✓</span>
    </button>`
    )
    .join("");

  grid.addEventListener("click", (event) => {
    const card = event.target.closest(".theme-card");
    if (!card) return;
    applyTheme(card.dataset.theme);
    renderThemes(grid);
  });
}

export function initSettings(root) {
  const grid = root.querySelector("#theme-grid");
  if (grid) renderThemes(grid);
}

if (typeof document !== "undefined") {
  const root = document.getElementById("settings-root");
  if (root) initSettings(root);
}
