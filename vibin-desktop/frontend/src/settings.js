import { applyTheme, getTheme, themes } from "./theme.js";

const grid = document.getElementById("theme-grid");

function render() {
  const active = getTheme();
  grid.innerHTML = Object.entries(themes).map(([id, theme]) => `
    <button class="theme-card${id === active ? " active" : ""}" data-theme="${id}" aria-pressed="${id === active}">
      <span class="preview">${theme.colors.map((color) => `<i style="background:${color}"></i>`).join("")}</span>
      <span class="copy"><strong>${theme.name}</strong><small>${theme.description}</small></span>
      <span class="check">✓</span>
    </button>`).join("");
}

grid.addEventListener("click", (event) => {
  const card = event.target.closest(".theme-card");
  if (!card) return;
  applyTheme(card.dataset.theme);
  render();
});

render();
