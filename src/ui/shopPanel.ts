// Shop overlay (FR-SHP-01..15): 5 tabs, per-character filtering, greyed items with reason, out-of-ammo alert, quick buy 1–6.
import type { ShopCategory, ShopItem } from '../config/types';
import { store } from '../core/store';
import { itemBlockReason, ownedCount, SHOP_TABS, showOutOfAmmoBanner, visibleItems } from '../logic/shop';
import type { Session } from '../game/session';
import { button, clear, el } from './dom';
import { S } from './strings.zh-CN';

export class ShopPanel {
  readonly root: HTMLElement;
  private tab: ShopCategory = 'seed';
  private readonly tabs: HTMLElement;
  private readonly items: HTMLElement;
  private readonly alert: HTMLElement;
  private readonly toast: HTMLElement;
  private toastTimer = 0;
  private visible: ShopItem[] = [];
  private lastKey = '';

  constructor(private readonly session: Session, onClose: () => void) {
    this.tabs = el('div', { class: 'tabs', testid: 'shop-tabs' });
    this.items = el('div', { class: 'items', testid: 'shop-items' });
    this.alert = el('div', { class: 'alert', testid: 'shop-out-of-ammo' }, el('span', {}, S.shopOutOfAmmo),
      button(S.shopBuyAmmoNow, 'shop-buy-ammo', () => this.buy('ammo_pack')));
    this.toast = el('div', { class: 'toast', testid: 'shop-toast' });
    this.root = el('div', { class: 'shop', testid: 'shop-panel' },
      el('header', {}, el('h2', {}, S.shopTitle), this.tabs),
      this.alert, this.items, this.toast,
      el('footer', {}, el('span', {}, S.shopHint), button(S.shopClose, 'shop-close', onClose, 'secondary')));
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());
    const firstWithItems = SHOP_TABS.find((t) => visibleItems(store.config.shop, session.character.id, t).length > 0);
    if (session.gun) this.tab = 'ammo';
    else if (firstWithItems) this.tab = 'seed';
    this.renderTabs();
  }

  open(): void {
    this.lastKey = '';
    this.refresh();
    requestAnimationFrame(() => this.root.classList.add('open'));
  }

  close(): void {
    this.root.classList.remove('open');
  }

  private renderTabs(): void {
    clear(this.tabs);
    for (const t of SHOP_TABS) {
      const b = button(S.shopTabs[t] ?? t, `shop-tab-${t}`, () => {
        this.tab = t;
        this.renderTabs();
        this.lastKey = '';
        this.refresh();
      });
      if (t === this.tab) b.classList.add('active');
      this.tabs.append(b);
    }
  }

  /** Quick buy (FR-SHP-11): the n-th item of the current tab. */
  quickBuy(index: number): void {
    const item = this.visible[index];
    if (item) this.buy(item.id);
  }

  private buy(id: string): void {
    const res = this.session.commands.dispatch({ type: 'purchase', itemId: id });
    if (!res.ok) this.showToast(S.buyFailed[res.reason ?? ''] ?? S.shopNoSun);
    this.lastKey = '';
    this.refresh();
  }

  private showToast(text: string): void {
    this.toast.textContent = text;
    this.toastTimer = 1.5;
  }

  update(dt: number): void {
    this.toastTimer -= dt;
    if (this.toastTimer <= 0) this.toast.textContent = '';
    this.refresh();
  }

  private refresh(): void {
    const s = this.session;
    const ctx = {
      characterId: s.character.id, wallet: s.wallet, inventory: s.inventory, ammo: s.gun?.ammo ?? null,
      ownedEquipment: s.ownedEquipment, upgrades: s.upgrades, ammoPackRounds: store.config.weapons.ammo_pack.rounds,
    };
    this.alert.style.display = showOutOfAmmoBanner(ctx) ? 'flex' : 'none';
    this.visible = visibleItems(store.config.shop, s.character.id, this.tab);
    const key = JSON.stringify([this.tab, Math.floor(s.wallet.sun), s.inventory.counts, s.gun?.ammo.reserve, [...s.ownedEquipment]]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    clear(this.items);
    if (this.visible.length === 0) this.items.append(el('div', { class: 'note' }, S.shopEmptyTab));
    this.visible.forEach((item, i) => {
      const reason = itemBlockReason(item, ctx);
      const owned = ownedCount(item, ctx);
      const ownedText = item.category === 'ammo' ? S.shopReserve(owned) : item.category === 'equipment' ? (owned ? S.shopOwnedEquip : '') : S.shopOwned(owned);
      const why = reason === 'insufficient_sun' ? S.shopNoSun : reason === 'full' ? (item.category === 'equipment' ? S.shopOwnedEquip : S.shopFull)
        : reason === 'hotbar_full' ? S.shopHotbarFull : reason === 'reserve_full' ? S.shopReserveFull : '';
      const card = el('button', { class: `card${reason ? ' blocked' : ''}`, testid: `shop-item-${item.id}`, type: 'button' },
        el('span', { class: 'hot' }, i < 6 ? `[${i + 1}]` : ''),
        el('div', { class: 'row' }, el('span', { class: 'ico' }, S.itemIcons[item.id] ?? '📦'), el('span', { class: 'price' }, S.price(item.price))),
        el('div', { class: 'name' }, item.name),
        el('div', { class: 'desc' }, item.desc),
        el('div', { class: 'row' }, el('span', { class: 'meta' }, ownedText), el('span', { class: 'why' }, why)),
      );
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        this.buy(item.id);
      });
      this.items.append(card);
    });
  }
}
