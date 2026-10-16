import React from 'react';
import ReactDOM from 'react-dom/client';
import App, { flushDraftWrites } from './App';
import { installDatasetGuard } from './datasetGuard';
import { installIOSViewport } from './iosViewport';
import './styles.css';
import './ios.css';

async function start() {
  if (new URLSearchParams(window.location.search).get('client') === 'ios') installIOSViewport();
  if (new URLSearchParams(window.location.search).get('local') === '1') {
    document.body.classList.add('native-ios');
    const { installMobileBackend } = await import('./mobileLocal/transport');
    await installMobileBackend(flushDraftWrites);
  } else installDatasetGuard();
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
}
start().catch(() => {
  const root = document.getElementById('root')!;
  root.replaceChildren(); const note = document.createElement('p'); note.textContent = '手机学习库未能打开。原有数据已保留，请关闭后重试；不要卸载 App。'; note.style.padding = '32px'; root.appendChild(note);
});
