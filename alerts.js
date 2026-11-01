// SPDX-License-Identifier: GPL-3.0-or-later
//
// Suggestion cards on screen, under the top bar on the button's side. A card
// stays until Jaime approves, rejects or closes it (closing keeps the
// suggestion in the menu), or until the suggestion is decided elsewhere. At
// login one summary card stands for the suggestions already waiting. Cards
// hide over fullscreen windows and do not show while banners are off (Do Not
// Disturb); the suggestions are still in the menu.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {ORIGINS} from './model.js';
import {DIM, MetaLine, iconButton, originBadge} from './widgets.js';

const GAP = 8;
const EASE_MS = 180;
const SUMMARY = 'summary';

function pill(label, accessibleName, extraClass) {
    return new St.Button({
        style_class: `fios-pill ${extraClass}`,
        label,
        accessible_name: accessibleName,
        can_focus: true,
    });
}

function wrappingLabel(styleClass) {
    const label = new St.Label({style_class: styleClass});
    label.clutter_text.line_wrap = true;
    label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

    return label;
}

function listNames(names) {
    if (names.length <= 1)
        return names.join('');

    return `${names.slice(0, -1).join(', ')} e ${names.at(-1)}`;
}

export class AlertStack {
    /**
     * @param {object} params
     * @param {string} params.side - 'left', 'center' or 'right'
     * @param {Gio.Icon} params.gicon - the extension's icon, for the summary card
     * @param {object} params.actions - approve(item), reject(item), openMenu()
     */
    constructor({side, gicon, actions}) {
        this._side = side;
        this._gicon = gicon;
        this._actions = actions;
        this._cards = new Map();
        this._notifications = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});

        this.actor = new St.BoxLayout({
            style_class: 'fios-toasts',
            orientation: Clutter.Orientation.VERTICAL,
            visible: false,
        });
        Main.layoutManager.addChrome(this.actor, {trackFullscreen: true});
        this.actor.connect('notify::width', () => this._place());
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._place());
    }

    get canShow() {
        return this._notifications.get_boolean('show-banners');
    }

    has(id) {
        return this._cards.has(id);
    }

    card(id) {
        return this._cards.get(id);
    }

    show(item) {
        if (!this.canShow || this._cards.has(item.id))
            return;
        const origin = ORIGINS[item.origin];
        const {card, head, body, buttons} = this._frame(item.id, originBadge(item.origin),
            `${origin.label} sugere`);
        head.accessible_name = `${origin.label} sugere: ${item.title}`;

        const title = wrappingLabel('fios-toast-title');
        title.text = item.title;
        body.add_child(title);
        const meta = new MetaLine();
        meta.update(item);
        body.add_child(meta.actor);

        const reject = pill('Rejeitar', 'Rejeitar sugestão', 'fios-pill-ghost');
        const approve = pill('Aprovar', 'Aprovar sugestão', 'fios-pill-accent');
        reject.connect('clicked', () => {
            this.remove(item.id);
            this._actions.reject(item);
        });
        approve.connect('clicked', () => {
            this.remove(item.id);
            this._actions.approve(item);
        });
        buttons.add_child(reject);
        buttons.add_child(approve);
        card._approve = approve;
        card._reject = reject;
        this._add(item.id, card);
    }

    /** One card for the suggestions already waiting; updates it if it is up. */
    showSummary(suggested) {
        if (suggested.length === 0) {
            this.remove(SUMMARY);

            return;
        }
        const count = suggested.length === 1 ? '1 sugestão à espera' : `${suggested.length} sugestões à espera`;
        const names = [...new Set(suggested.map(item => ORIGINS[item.origin].label))];
        const existing = this._cards.get(SUMMARY);
        if (existing) {
            existing._title.text = count;
            existing._detail.text = `De ${listNames(names)}`;

            return;
        }
        if (!this.canShow)
            return;

        const icon = new St.Icon({gicon: this._gicon, icon_size: 14, style_class: 'fios-toast-icon'});
        const {card, body, buttons} = this._frame(SUMMARY, icon, 'Fios');
        card._title = wrappingLabel('fios-toast-title');
        card._title.text = count;
        card._detail = new St.Label({style_class: 'fios-next', opacity: DIM, text: `De ${listNames(names)}`});
        body.add_child(card._title);
        body.add_child(card._detail);

        const open = pill('Ver', 'Abrir os fios', 'fios-pill-accent');
        open.connect('clicked', () => {
            this.remove(SUMMARY);
            this._actions.openMenu();
        });
        buttons.add_child(open);
        card._open = open;
        this._add(SUMMARY, card);
    }

    dismissSummary() {
        this.remove(SUMMARY);
    }

    /** Drops the cards of suggestions decided elsewhere (menu, notification, `fio`). */
    sync(suggested) {
        const ids = new Set(suggested.map(item => item.id));
        for (const id of [...this._cards.keys()]) {
            if (id !== SUMMARY && !ids.has(id))
                this.remove(id);
        }
        if (this._cards.has(SUMMARY))
            this.showSummary(suggested);
    }

    remove(id) {
        const card = this._cards.get(id);
        if (!card)
            return;
        this._cards.delete(id);
        card.reactive = false;
        card.ease({
            opacity: 0,
            translation_y: -GAP,
            duration: EASE_MS,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: () => {
                card.destroy();
                this.actor.visible = this._cards.size > 0;
            },
        });
    }

    _frame(id, leading, eyebrow) {
        const card = new St.BoxLayout({
            style_class: 'fios-toast',
            orientation: Clutter.Orientation.VERTICAL,
            reactive: true,
        });

        const head = new St.BoxLayout({style_class: 'fios-toast-head'});
        head.add_child(leading);
        head.add_child(new St.Label({
            style_class: 'fios-eyebrow',
            text: eyebrow,
            opacity: DIM,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        const close = iconButton('window-close-symbolic', 'Fechar (fica no menu)', 'fios-toast-close');
        close.connect('clicked', () => this.remove(id));
        head.add_child(close);
        card.add_child(head);

        const body = new St.BoxLayout({style_class: 'fios-toast-body', orientation: Clutter.Orientation.VERTICAL});
        card.add_child(body);

        const buttons = new St.BoxLayout({style_class: 'fios-toast-actions', x_align: Clutter.ActorAlign.END});
        card.add_child(buttons);
        card._close = close;

        return {card, head, body, buttons};
    }

    _add(id, card) {
        this._cards.set(id, card);
        // The summary goes on top: it speaks for the older suggestions.
        if (id === SUMMARY)
            this.actor.insert_child_at_index(card, 0);
        else
            this.actor.add_child(card);
        this.actor.visible = true;
        this._place();
        card.opacity = 0;
        card.translation_y = -GAP;
        card.ease({
            opacity: 255,
            translation_y: 0,
            duration: EASE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _place() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const width = this.actor.width;
        let x = monitor.x + monitor.width - width - GAP;
        if (this._side === 'left')
            x = monitor.x + GAP;
        else if (this._side === 'center')
            x = monitor.x + Math.round((monitor.width - width) / 2);
        this.actor.set_position(x, monitor.y + Main.panel.height + GAP);
    }

    destroy() {
        Main.layoutManager.disconnect(this._monitorsId);
        this.actor.destroy();
        this._cards.clear();
    }
}
