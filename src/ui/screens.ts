// Full-screen UI states: loading, error, main menu, character select, pause, settings, controls, confirm (FR-UI-01..03, FR-CHR-01).
import type { AllConfig, CharacterDef } from '../config/types';
import type { QualityLevel, Settings } from '../core/store';
import { button, el } from './dom';
import { S } from './strings.zh-CN';

export function loadingScreen(): { root: HTMLElement; set(progress: number, label: string): void } {
  const bar = el('div');
  const label = el('div', { class: 'note', testid: 'loading-label' }, S.loading);
  const root = el('div', { class: 'screen', testid: 'screen-loading' },
    el('h1', { class: 'title' }, S.title), el('div', { class: 'progress' }, bar), label);
  return {
    root,
    set(progress, text) {
      bar.style.width = `${Math.round(progress * 100)}%`;
      label.textContent = text;
    },
  };
}

export function errorScreen(title: string, lines: string[], hint: string): HTMLElement {
  const list = el('div', { class: 'error-list', testid: 'error-list' });
  for (const l of lines) list.append(el('div', {}, l));
  return el('div', { class: 'screen', testid: 'screen-error' }, el('h1', { class: 'title' }, title), list, el('div', { class: 'note' }, hint));
}

export interface MainMenuActions {
  hasSave: boolean;
  saveNote: string | null;
  onStart(): void;
  onContinue(): void;
  onSettings(): void;
  onControls(): void;
  onDelete(): void;
}

export function mainMenu(a: MainMenuActions): HTMLElement {
  const cont = button(a.hasSave ? S.menuContinue : `${S.menuContinue}${S.menuNoSave}`, 'menu-continue', a.onContinue);
  cont.disabled = !a.hasSave;
  const del = button(S.menuDelete, 'menu-delete', a.onDelete, 'danger');
  del.disabled = !a.hasSave && !a.saveNote;
  return el('div', { class: 'screen', testid: 'screen-main-menu' },
    el('h1', { class: 'title' }, S.title),
    el('div', { class: 'subtitle' }, S.subtitle),
    button(S.menuStart, 'menu-start', a.onStart),
    cont,
    button(S.menuSettings, 'menu-settings', a.onSettings, 'secondary'),
    button(S.menuControls, 'menu-controls', a.onControls, 'secondary'),
    del,
    a.saveNote ? el('div', { class: 'note', testid: 'menu-save-note' }, a.saveNote) : null,
  );
}

function charRows(c: CharacterDef, cfg: AllConfig): string[] {
  const shopName = (id: string): string => cfg.shop.items.find((i) => i.id === id)?.name ?? id;
  const plantNames = Object.values(cfg.plants.plants).filter((p) => c.availableSeeds.includes(p.seedItemId)).map((p) => p.displayName);
  const gun = c.weapon ? cfg.weapons.pea_gun : null;
  return [
    S.roleNames[c.role] ?? c.role,
    String(c.maxHealth),
    `×${c.moveSpeedMultiplier}`,
    c.weapon ? S.attackGun : S.attackNone,
    c.passiveSunPerSecond > 0 ? S.passiveRate(c.passiveSunPerSecond) : S.passiveNone,
    plantNames.join('、'),
    c.blockedSeeds.filter((id) => cfg.shop.items.find((i) => i.id === id)?.category === 'seed').map(shopName).join('、'),
    gun ? S.ammoText(gun.magazineSize, gun.reserveAmmoMax) : S.no,
    String(c.startingSun),
    Object.entries(c.startingItems).map(([id, n]) => `${shopName(id)} ×${n}`).join('、'),
  ];
}

export function characterSelect(cfg: AllConfig, onPick: (id: string) => void, onBack: () => void): HTMLElement {
  const chars = Object.values(cfg.characters);
  const labels = Object.values(S.attrRows);
  const table = el('table', { class: 'compare', testid: 'character-compare' });
  const head = el('tr', {}, el('th', {}, ''));
  for (const c of chars) head.append(el('th', {}, `${S.characterIcons[c.id] ?? ''} ${c.displayName}`));
  table.append(head);
  const tagline = el('tr', {}, el('td', {}, ''));
  for (const c of chars) tagline.append(el('td', { class: 'tagline' }, `「${c.tagline}」`));
  table.append(tagline);
  const rows = chars.map((c) => charRows(c, cfg));
  labels.forEach((label, i) => {
    const tr = el('tr', {}, el('th', {}, label));
    rows.forEach((r) => tr.append(el('td', {}, r[i] ?? '')));
    table.append(tr);
  });
  const buttons = el('div', { class: 'char-cards' });
  for (const c of chars) buttons.append(button(S.pick(c.displayName), `character-pick-${c.id}`, () => onPick(c.id)));
  return el('div', { class: 'screen', testid: 'screen-character-select' },
    el('h1', { class: 'title' }, S.chooseCharacter), el('div', { class: 'note' }, S.chooseHint), table, buttons,
    button(S.back, 'character-back', onBack, 'secondary'));
}

export function pauseMenu(a: { onResume(): void; onSettings(): void; onControls(): void; onMainMenu(): void }): HTMLElement {
  return el('div', { class: 'screen overlay', testid: 'screen-pause' },
    el('h1', { class: 'title' }, S.pauseTitle),
    button(S.resume, 'pause-resume', a.onResume),
    button(S.menuSettings, 'pause-settings', a.onSettings, 'secondary'),
    button(S.menuControls, 'pause-controls', a.onControls, 'secondary'),
    button(S.toMainMenu, 'pause-main-menu', a.onMainMenu, 'danger'),
    controlsTable(),
  );
}

export function controlsTable(): HTMLElement {
  const grid = el('div', { class: 'keys panel', testid: 'controls-table' });
  for (const [k, v] of S.controls) grid.append(el('kbd', {}, k), el('span', {}, v));
  return grid;
}

export function controlsScreen(onBack: () => void): HTMLElement {
  return el('div', { class: 'screen', testid: 'screen-controls' }, el('h1', { class: 'title' }, S.controlsTitle), controlsTable(),
    button(S.back, 'controls-back', onBack, 'secondary'));
}

export function settingsScreen(
  s: Settings,
  limits: { min: number; max: number },
  onChange: (s: Settings) => void,
  onBack: () => void,
  overlay: boolean,
): HTMLElement {
  const grid = el('div', { class: 'settings-grid panel' });
  const slider = (label: string, key: 'sensitivity' | 'masterVolume' | 'sfxVolume' | 'musicVolume', min: number, max: number, step: number): void => {
    const input = el('input', { type: 'range', min, max, step, value: s[key], testid: `settings-${key}` });
    const out = el('span', {}, s[key].toFixed(key === 'sensitivity' ? 1 : 2));
    input.addEventListener('input', () => {
      s[key] = Number(input.value);
      out.textContent = s[key].toFixed(key === 'sensitivity' ? 1 : 2);
      onChange(s);
    });
    grid.append(el('label', {}, label), input, out);
  };
  const toggle = (label: string, key: 'headBob' | 'invertY'): void => {
    const b = button(s[key] ? S.on : S.off, `settings-${key}`, () => {
      s[key] = !s[key];
      b.textContent = s[key] ? S.on : S.off;
      onChange(s);
    }, 'secondary');
    b.style.minWidth = '5em';
    grid.append(el('label', {}, label), b, el('span'));
  };
  slider(S.setSensitivity, 'sensitivity', limits.min, limits.max, 0.1);
  slider(S.setMaster, 'masterVolume', 0, 1, 0.05);
  slider(S.setSfx, 'sfxVolume', 0, 1, 0.05);
  slider(S.setMusic, 'musicVolume', 0, 1, 0.05);
  const q = el('select', { testid: 'settings-quality' });
  for (const lvl of ['low', 'medium', 'high'] as QualityLevel[]) {
    const o = el('option', { value: lvl }, S.qualityNames[lvl] ?? lvl);
    if (lvl === s.quality) o.selected = true;
    q.append(o);
  }
  q.addEventListener('change', () => {
    s.quality = q.value as QualityLevel;
    onChange(s);
  });
  grid.append(el('label', {}, S.setQuality), q, el('span'));
  toggle(S.setHeadBob, 'headBob');
  toggle(S.setInvertY, 'invertY');
  return el('div', { class: `screen${overlay ? ' overlay' : ''}`, testid: 'screen-settings' },
    el('h1', { class: 'title' }, S.settingsTitle), grid, button(S.back, 'settings-back', onBack, 'secondary'));
}

export function confirmDialog(title: string, body: string, onYes: () => void, onNo: () => void): HTMLElement {
  return el('div', { class: 'screen overlay', testid: 'dialog-confirm' },
    el('div', { class: 'panel' },
      el('h2', {}, title), el('p', { class: 'note' }, body),
      el('div', { class: 'char-cards' }, button(S.confirm, 'dialog-confirm-yes', onYes, 'danger'), button(S.cancel, 'dialog-confirm-no', onNo, 'secondary'))));
}
