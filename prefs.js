// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const POSITIONS = [['left', 'Esquerda'], ['center', 'Centro'], ['right', 'Direita']];

export default class FiosPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();

        const bar = new Adw.PreferencesGroup({title: 'Top bar'});
        const position = new Adw.ComboRow({
            title: 'Posição do botão',
            model: Gtk.StringList.new(POSITIONS.map(([, label]) => label)),
        });
        const current = POSITIONS.findIndex(([id]) => id === settings.get_string('position'));
        position.selected = current === -1 ? 2 : current;
        position.connect('notify::selected', () =>
            settings.set_string('position', POSITIONS[position.selected][0]));
        bar.add(position);

        const shortcut = new Adw.EntryRow({
            title: 'Atalho para abrir (ex.: <Super>period; vazio para nenhum)',
            text: settings.get_strv('toggle-shortcut')[0] ?? '',
            show_apply_button: true,
        });
        shortcut.connect('apply', () => {
            const text = shortcut.text.trim();
            if (text && !Gtk.accelerator_parse(text)[0]) {
                shortcut.add_css_class('error');

                return;
            }
            shortcut.remove_css_class('error');
            settings.set_strv('toggle-shortcut', text ? [text] : []);
        });
        bar.add(shortcut);
        page.add(bar);

        const agents = new Adw.PreferencesGroup({
            title: 'Sugestões dos agentes',
            description: 'Os agentes propõem fios com `fio propor`; aprovas ou rejeitas no menu.',
        });
        const notify = new Adw.SwitchRow({title: 'Notificar quando chega uma sugestão'});
        settings.bind('notify', notify, 'active', Gio.SettingsBindFlags.DEFAULT);
        agents.add(notify);
        page.add(agents);

        window.add(page);
    }
}
