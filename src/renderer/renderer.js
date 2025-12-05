import { App } from './components/App.js';

window.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('root');
  if (!root) return;

  root.innerHTML = '';
  root.appendChild(App());
});
