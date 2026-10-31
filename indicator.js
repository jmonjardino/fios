// SPDX-License-Identifier: GPL-3.0-or-later
//
// The top bar button and its menu: suggestions from the agents to approve or
// reject, the threads in progress with a check to close them, and the ones
// closed this week to reopen. A line at the top adds a thread by hand.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
    ORIGINS,
    arrange,
    linkUri,
    makeItem,
    parseQuickAdd,
    projectTone,
    relativeTime,
    summary,
    transition,
} from './model.js';
import * as Store from './store.js';

// How long "Remover?" waits for the second click.
const CONFIRM_MS = 4000;

// Secondary text is dimmed by opacity so it suits the light and dark styles alike.
const DIM = 165;

function iconButton(iconName, accessibleName, extraClass = '') {
    return new St.Button({
        style_class: `fios-action ${extraClass}`.trim(),
        child: new St.Icon({icon_name: iconName, icon_size: 14}),
        accessible_name: accessibleName,
        can_focus: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
}

/**
 * A menu row that is not a menu item: not hovered, not activated, not dimmed.
 * It stays reactive, since St greys out a widget that is not (`:insensitive`).
 */
function staticItem(styleClass) {
    const item = new PopupMenu.PopupBaseMenuItem({
        activate: false,
        hover: false,
        can_focus: false,
        style_class: styleClass,
    });
    item.remove_style_class_name('popup-inactive-menu-item');
    item.track_hover = false;

    return item;
}

function originBadge(origin) {
    return new St.Label({
        style_class: `fios-origin fios-origin-${origin}`,
        text: ORIGINS[origin].letter,
        y_align: Clutter.ActorAlign.CENTER,
    });
}

/** Project dot and name, then the next step: the row's second line. */
class MetaLine {
    constructor() {
        this.actor = new St.BoxLayout({style_class: 'fios-meta'});
        this._dot = new St.Widget({style_class: 'fios-dot', y_align: Clutter.ActorAlign.CENTER});
        this._project = new St.Label({style_class: 'fios-project', y_align: Clutter.ActorAlign.CENTER});
        this._next = new St.Label({
            style_class: 'fios-next',
            opacity: DIM,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._next.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        for (const child of [this._dot, this._project, this._next])
            this.actor.add_child(child);
    }

    update(item) {
        const tone = projectTone(item.project);
        this._dot.style_class = `fios-dot fios-tone-${tone}`;
        this._dot.visible = Boolean(item.project);
        this._project.style_class = `fios-project fios-text-${tone}`;
        this._project.text = item.project;
        this._project.visible = Boolean(item.project);
        this._next.text = item.next ? `→ ${item.next}` : '';
        this._next.visible = Boolean(item.next);
        this.actor.visible = Boolean(item.project || item.next);
    }
}

const ThreadRow = GObject.registerClass(
class ThreadRow extends PopupMenu.PopupBaseMenuItem {
    _init(actions) {
        super._init({style_class: 'fios-row'});
        this._actions = actions;

        this._check = new St.Button({
            style_class: 'fios-check',
            child: new St.Icon({icon_name: 'object-select-symbolic', icon_size: 10}),
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._check);

        const text = new St.BoxLayout({
            style_class: 'fios-text',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._title = new St.Label({style_class: 'fios-title'});
        this._title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._meta = new MetaLine();
        text.add_child(this._title);
        text.add_child(this._meta.actor);
        this.add_child(text);

        const trailing = new St.BoxLayout({style_class: 'fios-trailing', y_align: Clutter.ActorAlign.CENTER});
        this._origin = originBadge('jaime');
        this._link = iconButton('external-link-symbolic', 'Abrir link');
        this._remove = iconButton('user-trash-symbolic', 'Remover', 'fios-action-danger');
        this._confirm = new St.Button({
            style_class: 'fios-pill fios-pill-danger',
            label: 'Remover?',
            accessible_name: 'Confirmar remoção',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        for (const child of [this._confirm, this._link, this._remove, this._origin])
            trailing.add_child(child);
        this.add_child(trailing);
        this._buttons = [this._check, trailing];

        // A press on a row button is the button's, not the row's: the row
        // would open the link and close the menu.
        this._clickGesture.connect('may-recognize', () => !this._isOnButtons());

        this._check.connect('clicked', () => actions.toggle(this.item));
        this._link.connect('clicked', () => actions.open(this.item));
        this._remove.connect('clicked', () => this._arm());
        this._confirm.connect('clicked', () => actions.remove(this.item));
        this.connect('activate', () => actions.open(this.item));
        this.connect('notify::active', () => this._sync());
        this.connect('destroy', () => this._disarm());
    }

    _isOnButtons() {
        const {x, y} = this._clickGesture.get_coords_abs();
        const actor = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);

        return actor !== null && this._buttons.some(box => box.contains(actor));
    }

    update(item) {
        this.item = item;
        const isDone = item.status === 'done';
        const title = GLib.markup_escape_text(item.title, -1);
        this._title.clutter_text.set_markup(isDone ? `<s>${title}</s>` : title);
        this._title.opacity = isDone ? DIM : 255;
        this._meta.update(item);
        this._meta.actor.opacity = isDone ? 140 : 255;
        this._origin.style_class = `fios-origin fios-origin-${item.origin}`;
        this._origin.text = ORIGINS[item.origin].letter;
        this._check.checked = isDone;
        this._check.accessible_name = isDone ? 'Reabrir' : 'Marcar como feito';
        this.accessible_name = [item.title, item.project, item.next].filter(Boolean).join(', ');
        this._sync();
    }

    _sync() {
        const isArmed = Boolean(this._armId);
        const showActions = this.active || isArmed;
        this._origin.visible = !showActions;
        const uri = linkUri(this.item?.link, GLib.get_home_dir());
        this._link.child.icon_name = uri?.startsWith('file://') ? 'folder-open-symbolic' : 'web-browser-symbolic';
        this._link.visible = showActions && !isArmed && Boolean(uri);
        this._remove.visible = showActions && !isArmed;
        this._confirm.visible = isArmed;
    }

    _arm() {
        this._disarm();
        this._armId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CONFIRM_MS, () => {
            this._armId = 0;
            this._sync();

            return GLib.SOURCE_REMOVE;
        });
        this._sync();
    }

    _disarm() {
        if (this._armId)
            GLib.Source.remove(this._armId);
        this._armId = 0;
    }
});

const SuggestionRow = GObject.registerClass(
class SuggestionRow extends PopupMenu.PopupBaseMenuItem {
    _init(actions) {
        super._init({activate: false, hover: false, can_focus: false, style_class: 'fios-suggestion'});
        this.remove_style_class_name('popup-inactive-menu-item');
        this.track_hover = false;

        this._origin = originBadge('claude');
        this._origin.y_align = Clutter.ActorAlign.START;
        this.add_child(this._origin);

        const text = new St.BoxLayout({
            style_class: 'fios-text',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._eyebrow = new St.Label({style_class: 'fios-eyebrow', opacity: DIM});
        // A decision needs the whole title: it wraps instead of ellipsizing.
        this._title = new St.Label({style_class: 'fios-title'});
        this._title.clutter_text.line_wrap = true;
        this._title.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._meta = new MetaLine();
        text.add_child(this._eyebrow);
        text.add_child(this._title);
        text.add_child(this._meta.actor);
        this.add_child(text);

        const buttons = new St.BoxLayout({style_class: 'fios-decide', y_align: Clutter.ActorAlign.CENTER});
        this._reject = iconButton('window-close-symbolic', 'Rejeitar sugestão', 'fios-action-danger');
        this._approve = new St.Button({
            style_class: 'fios-pill fios-pill-accent',
            label: 'Aprovar',
            accessible_name: 'Aprovar sugestão',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        buttons.add_child(this._reject);
        buttons.add_child(this._approve);
        this.add_child(buttons);

        this._reject.connect('clicked', () => actions.reject(this.item));
        this._approve.connect('clicked', () => actions.approve(this.item));
    }

    update(item) {
        this.item = item;
        this._origin.style_class = `fios-origin fios-origin-${item.origin}`;
        this._origin.text = ORIGINS[item.origin].letter;
        this._eyebrow.text = `${ORIGINS[item.origin].label} sugere · ${relativeTime(item.createdAt)}`;
        this._title.text = item.title;
        this._meta.update(item);
        this.accessible_name = `${ORIGINS[item.origin].label} sugere: ${item.title}`;
    }
});

/** A section with a small caption and rows kept in step with a list of threads. */
class Section {
    constructor(menu, caption, makeRow) {
        this.section = new PopupMenu.PopupMenuSection();
        this.caption = staticItem('fios-caption');
        this._label = new St.Label({text: caption.toUpperCase(), opacity: 140, x_expand: true});
        this.caption.add_child(this._label);
        this.section.addMenuItem(this.caption);
        this.rows = new PopupMenu.PopupMenuSection();
        this.section.addMenuItem(this.rows);
        menu.addMenuItem(this.section);
        this._makeRow = makeRow;
        this._byId = new Map();
        this._order = '';
    }

    get size() {
        return this._byId.size;
    }

    row(id) {
        return this._byId.get(id);
    }

    update(items) {
        const order = items.map(item => item.id).join(',');
        if (order !== this._order) {
            for (const row of this._byId.values())
                row.destroy();
            this._byId.clear();
            for (const item of items) {
                const row = this._makeRow();
                this.rows.addMenuItem(row);
                this._byId.set(item.id, row);
            }
            this._order = order;
        }
        for (const item of items)
            this._byId.get(item.id).update(item);
        this.section.actor.visible = items.length > 0;
    }
}

export const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(extension, settings) {
        super._init(0.5, 'Fios');
        this._settings = settings;
        this._items = null;
        this._error = null;
        this._seen = null;
        this._showDone = false;

        const iconFile = extension.dir.get_child('icons').get_child('fios-symbolic.svg');
        this._gicon = new Gio.FileIcon({file: iconFile});

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box fios-panel'});
        this._icon = new St.Icon({gicon: this._gicon, style_class: 'system-status-icon'});
        this._badge = new St.Label({style_class: 'fios-badge', y_align: Clutter.ActorAlign.CENTER});
        this._pending = new St.Widget({style_class: 'fios-pending', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._icon);
        box.add_child(this._badge);
        box.add_child(this._pending);
        this.add_child(box);

        this.menu.actor.add_style_class_name('fios-popup');
        this.menu.box.add_style_class_name('fios-menu');
        this._buildMenu();

        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen) {
                this._render();
            } else {
                this._addRow.visible = false;
                this._entry.text = '';
            }
        });

        this._unwatch = Store.watch(() => this._reload());
        this._render();
        this._reload();
    }

    _buildMenu() {
        const header = staticItem('fios-header');
        const titles = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        titles.add_child(new St.Label({text: 'Fios', style_class: 'fios-heading'}));
        this._summary = new St.Label({style_class: 'fios-summary', opacity: DIM});
        titles.add_child(this._summary);
        header.add_child(titles);
        this._addButton = iconButton('list-add-symbolic', 'Novo fio', 'fios-action-add');
        this._addButton.connect('clicked', () => this._toggleAdd());
        header.add_child(this._addButton);
        this.menu.addMenuItem(header);

        this._addRow = staticItem('fios-add');
        this._entry = new St.Entry({
            style_class: 'fios-entry',
            hint_text: 'Novo fio…  #projeto  // próximo passo',
            can_focus: true,
            x_expand: true,
        });
        this._entry.clutter_text.connect('activate', () => this._addFromEntry());
        this._addRow.add_child(this._entry);
        this._addRow.visible = false;
        this.menu.addMenuItem(this._addRow);

        const actions = {
            approve: item => this._apply(item, 'approve'),
            reject: item => this._delete(item),
            toggle: item => this._apply(item, item.status === 'done' ? 'reopen' : 'done'),
            open: item => this._open(item),
            remove: item => this._delete(item),
        };
        this._suggested = new Section(this.menu, 'Sugestões', () => new SuggestionRow(actions));
        this._active = new Section(this.menu, 'Em curso', () => new ThreadRow(actions));
        this._done = new Section(this.menu, 'Concluídos', () => new ThreadRow(actions));

        // The done caption folds its rows away; open, it lists this week's.
        this._doneToggle = new St.Button({
            style_class: 'fios-fold',
            can_focus: true,
            x_expand: true,
            child: new St.BoxLayout({x_expand: true, x_align: Clutter.ActorAlign.FILL, style_class: 'fios-fold-box'}),
        });
        this._doneLabel = new St.Label({opacity: 140, y_align: Clutter.ActorAlign.CENTER});
        this._doneLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._doneArrow = new St.Icon({
            icon_name: 'pan-end-symbolic',
            icon_size: 12,
            opacity: 140,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._doneToggle.child.add_child(this._doneLabel);
        this._doneToggle.child.add_child(this._doneArrow);
        this._doneToggle.connect('clicked', () => {
            this._showDone = !this._showDone;
            this._render();
        });
        this._done.caption.remove_all_children();
        this._done.caption.add_child(this._doneToggle);

        this._empty = staticItem('fios-empty');
        const empty = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        empty.add_child(new St.Icon({
            gicon: this._gicon,
            icon_size: 36,
            style_class: 'fios-empty-icon',
            opacity: 110,
            x_align: Clutter.ActorAlign.CENTER,
        }));
        this._emptyTitle = new St.Label({style_class: 'fios-empty-title', x_align: Clutter.ActorAlign.CENTER});
        this._emptyText = new St.Label({style_class: 'fios-empty-text', opacity: DIM, x_align: Clutter.ActorAlign.CENTER});
        this._emptyText.clutter_text.line_wrap = true;
        empty.add_child(this._emptyTitle);
        empty.add_child(this._emptyText);
        this._empty.add_child(empty);
        this.menu.addMenuItem(this._empty);
    }

    toggleMenu() {
        this.menu.toggle();
    }

    _toggleAdd() {
        this._addRow.visible = !this._addRow.visible;
        if (this._addRow.visible)
            this._entry.grab_key_focus();
        this._render();
    }

    async _reload() {
        try {
            const items = await Store.readAll();
            if (this._isDestroyed)
                return;
            this._items = items;
            this._error = null;
        } catch (error) {
            if (this._isDestroyed)
                return;
            this._error = error.message;
        }
        this._notifyNew();
        this._render();
    }

    _render() {
        const lists = arrange(this._items ?? []);
        const {suggested, active, done} = lists;

        this._badge.text = String(active.length);
        this._badge.visible = active.length > 0;
        this._pending.visible = suggested.length > 0;
        this._icon.opacity = active.length + suggested.length > 0 ? 255 : 150;

        if (this._error)
            this._summary.text = 'Erro ao ler os fios';
        else if (this._items === null)
            this._summary.text = 'A carregar…';
        else
            this._summary.text = summary(lists);

        this._suggested.update(suggested);
        this._active.update(active);
        this._done.update(this._showDone ? done : []);
        this._done.section.actor.visible = done.length > 0;
        this._doneLabel.text = `CONCLUÍDOS · ${done.length}`;
        this._doneArrow.icon_name = this._showDone ? 'pan-down-symbolic' : 'pan-end-symbolic';

        const isEmpty = suggested.length === 0 && active.length === 0;
        this._empty.visible = isEmpty && !this._addRow.visible;
        if (this._error) {
            this._emptyTitle.text = 'Não consegui ler os fios';
            this._emptyText.text = this._error;
        } else {
            this._emptyTitle.text = 'Nada em curso';
            this._emptyText.text = 'Adiciona um fio com + ou espera pelas sugestões dos agentes.';
        }
    }

    // Optimistic: the menu changes now, the file follows, and the monitor's
    // reload confirms it (or brings back what is really on disk).
    _replace(item) {
        this._items = (this._items ?? []).filter(one => one.id !== item.id);
        this._items.push(item);
        this._render();
    }

    async _apply(item, action) {
        try {
            const next = transition(item, action);
            this._replace(next);
            await Store.write(next);
        } catch (error) {
            Main.notifyError('Fios', error.message);
            this._reload();
        }
    }

    async _delete(item) {
        this._items = (this._items ?? []).filter(one => one.id !== item.id);
        this._render();
        try {
            await Store.remove(item.id);
        } catch (error) {
            Main.notifyError('Fios', `Não consegui remover "${item.title}": ${error.message}`);
            this._reload();
        }
    }

    async _addFromEntry() {
        const text = this._entry.text;
        if (!text.trim())
            return;
        try {
            const item = makeItem(parseQuickAdd(text), {origin: 'jaime'});
            this._entry.text = '';
            this._replace(item);
            await Store.write(item);
        } catch (error) {
            Main.notifyError('Fios', error.message);
        }
    }

    _open(item) {
        const uri = linkUri(item.link, GLib.get_home_dir());
        if (!uri)
            return;
        try {
            Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
        } catch (error) {
            Main.notifyError('Fios', `Não consegui abrir ${item.link}: ${error.message}`);
        }
    }

    // A desktop notification for each suggestion that arrives while the Shell
    // runs; the ones already waiting at login only show in the menu.
    _notifyNew() {
        const suggested = (this._items ?? []).filter(item => item.status === 'suggested');
        const ids = new Set(suggested.map(item => item.id));
        if (this._seen === null || !this._settings.get_boolean('notify')) {
            this._seen = ids;

            return;
        }
        for (const item of suggested) {
            if (!this._seen.has(item.id))
                this._notify(item);
        }
        this._seen = ids;
    }

    _source() {
        if (!this._notificationSource) {
            this._notificationSource = new MessageTray.Source({title: 'Fios', icon: this._gicon});
            this._notificationSource.connect('destroy', () => {
                this._notificationSource = null;
            });
            Main.messageTray.add(this._notificationSource);
        }

        return this._notificationSource;
    }

    _notify(item) {
        const source = this._source();
        const body = [item.project && `#${item.project}`, item.next && `→ ${item.next}`].filter(Boolean).join('  ');
        const notification = new MessageTray.Notification({
            source,
            title: `${ORIGINS[item.origin].label} sugere: ${item.title}`,
            body,
        });
        notification.addAction('Aprovar', () => this._apply(item, 'approve'));
        notification.addAction('Rejeitar', () => this._delete(item));
        source.addNotification(notification);
    }

    destroy() {
        this._isDestroyed = true;
        this._unwatch?.();
        this._unwatch = null;
        this._notificationSource?.destroy();
        super.destroy();
    }
});
