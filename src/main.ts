// Entry point.
import './ui/styles.css';
import { App } from './game/app';

function showFatal(err: unknown): void {
  console.error('[main] 启动失败：', err);
  const root = document.getElementById('ui-root');
  if (!root) return;
  const box = document.createElement('div');
  box.className = 'screen';
  box.setAttribute('data-testid', 'screen-fatal');
  const title = document.createElement('h1');
  title.className = 'title';
  title.textContent = '启动失败';
  const msg = document.createElement('div');
  msg.className = 'error-list';
  msg.textContent = err instanceof Error ? err.message : String(err);
  box.append(title, msg);
  root.append(box);
}

try {
  new App().boot().catch(showFatal);
} catch (err) {
  showFatal(err);
}
