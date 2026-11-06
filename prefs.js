// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const POSITIONS = [['left', 'Esquerda'], ['center', 'Centro'], ['right', 'Direita']];
const ALERTS = [
    ['persistent', 'Cartão no ecrã até decidir'],
    ['banner', 'Notificação normal do GNOME'],
    ['off', 'Só no menu'],
];

function choiceRow(settings, key, title, choices, fallback) {
    const row = new Adw.ComboRow({title, model: Gtk.StringList.new(choices.map(([, label]) => label))});
    const current = choices.findIndex(([id]) => id === settings.get_string(key));
    row.selected = current === -1 ? fallback : current;
    row.connect('notify::selected', () => settings.set_string(key, choices[row.selected][0]));

    return row;
}

export default class FiosPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();

        const bar = new Adw.PreferencesGroup({title: 'Top bar'});
        bar.add(choiceRow(settings, 'position', 'Posição do botão e dos cartões', POSITIONS, 2));

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
        agents.add(choiceRow(settings, 'alerts', 'Quando chega uma sugestão', ALERTS, 0));
        page.add(agents);

        window.add(page);
    }
}
