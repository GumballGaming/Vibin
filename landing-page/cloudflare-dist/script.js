const copyButton = document.querySelector('#copy-button');
const themeToggle = document.querySelector('.theme-toggle');
const storedTheme = localStorage.getItem('vibin-theme');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

function setTheme(theme) {
  const isDark = theme === 'dark';
  document.documentElement.dataset.theme = theme;
  themeToggle?.setAttribute('aria-pressed', String(isDark));
  themeToggle?.setAttribute('aria-label', `Switch to ${isDark ? 'light' : 'dark'} mode`);
}

setTheme(storedTheme ?? (prefersDark ? 'dark' : 'light'));

themeToggle?.addEventListener('click', () => {
  const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('vibin-theme', nextTheme);
  setTheme(nextTheme);
});

copyButton?.addEventListener('click', async () => {
  await navigator.clipboard.writeText('bun install -g vibin');
  copyButton.textContent = 'Copied!';
  window.setTimeout(() => { copyButton.textContent = 'Copy'; }, 1800);
});
