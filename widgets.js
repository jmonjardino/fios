// SPDX-License-Identifier: GPL-3.0-or-later
//
// Pieces shared by the menu and the on-screen suggestion cards.

import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {ORIGINS, projectTone} from './model.js';

// Secondary text is dimmed by opacity so it suits the light and dark styles alike.
export const DIM = 165;

export function iconButton(iconName, accessibleName, extraClass = '') {
    return new St.Button({
        style_class: `fios-action ${extraClass}`.trim(),
        child: new St.Icon({icon_name: iconName, icon_size: 14}),
        accessible_name: accessibleName,
        can_focus: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
}

export function originBadge(origin) {
    return new St.Label({
        style_class: `fios-origin fios-origin-${origin}`,
        text: ORIGINS[origin].letter,
        y_align: Clutter.ActorAlign.CENTER,
    });
}

/** Project dot and name, then the next step: the row's second line. */
export class MetaLine {
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
