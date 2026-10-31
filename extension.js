// SPDX-License-Identifier: GPL-3.0-or-later

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Indicator} from './indicator.js';

const BOXES = ['left', 'center', 'right'];

export default class FiosExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._place();
        this._settingsId = this._settings.connect('changed::position', () => this._place());

        Main.wm.addKeybinding('toggle-shortcut', this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._indicator?.toggleMenu());
    }

    // Moving the button means a new one: the panel has no call to move it.
    _place() {
        this._indicator?.destroy();
        const position = this._settings.get_string('position');
        const box = BOXES.includes(position) ? position : 'right';
        this._indicator = new Indicator(this, this._settings);
        Main.panel.addToStatusArea(this.uuid, this._indicator, box === 'right' ? 0 : -1, box);
    }

    disable() {
        Main.wm.removeKeybinding('toggle-shortcut');
        this._settings.disconnect(this._settingsId);
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
