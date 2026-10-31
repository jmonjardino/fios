// SPDX-License-Identifier: GPL-3.0-or-later
//
// Run by `make test-shell` inside a headless GNOME Shell (gnome-shell-test-tool):
// seeds a throwaway threads folder, opens the menu, approves a suggestion,
// ticks a thread off, adds one by hand, and screenshots each state in the
// dark and light styles.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

Gio._promisify(Shell.Screenshot.prototype, 'screenshot_area', 'screenshot_area_finish');

const UUID = 'fios@jmonjardino.dev';
const OUT = GLib.getenv('FIOS_SHOTS') ?? GLib.get_tmp_dir();
const DIR = GLib.getenv('FIOS_DIR');

export const METRICS = {};

const failures = [];

function check(condition, what) {
    if (!condition)
        failures.push(what);
}

function ago(minutes) {
    return new Date(Date.now() - minutes * 60000).toISOString();
}

const SEED = [
    {id: 'sug1', title: 'Corrigir o lint do PR da exportação', project: 'website',
        next: 'ver o log do CI', origin: 'claude', status: 'suggested', createdAt: ago(4)},
    {id: 'sug2', title: 'Rever os índices da base de dados', project: 'app-mobile',
        next: '', origin: 'codex', status: 'suggested', createdAt: ago(40)},
    {id: 'act1', title: 'Motor de pesquisa: filtros por data', project: 'website',
        next: 'testar com dados reais', origin: 'jaime', status: 'active',
        link: 'https://github.com/example/website/pull/12', createdAt: ago(300)},
    {id: 'act2', title: 'Relatório final da cadeira', project: 'estudos',
        next: 'secção 4 — resultados da PoC', origin: 'antigravity', status: 'active', createdAt: ago(120)},
    {id: 'act3', title: 'Responder ao email do cliente', project: 'freelance',
        next: '', origin: 'hermes', status: 'active', createdAt: ago(60)},
    {id: 'don1', title: 'Submeter a proposta do projeto', project: 'estudos',
        origin: 'jaime', status: 'done', createdAt: ago(3000), doneAt: ago(1500)},
];

function seed() {
    GLib.mkdir_with_parents(DIR, 0o755);
    for (const item of SEED) {
        const full = {project: '', next: '', link: '', updatedAt: item.createdAt, doneAt: null, ...item};
        GLib.file_set_contents(`${DIR}/${item.id}.json`, JSON.stringify(full));
    }
}

function readFile(id) {
    try {
        const [, bytes] = GLib.file_get_contents(`${DIR}/${id}.json`);

        return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        return null;
    }
}

async function shoot(actor, name) {
    const [x, y] = actor.get_transformed_position();
    const [width, height] = actor.get_transformed_size();
    const stream = Gio.File.new_for_path(`${OUT}/${name}.png`)
        .replace(null, false, Gio.FileCreateFlags.NONE, null);
    await new Shell.Screenshot().screenshot_area(
        Math.round(x), Math.round(y), Math.round(width), Math.round(height), stream);
    stream.close(null);
}

const pointer = Clutter.get_default_backend().get_default_seat()
    .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);

async function hover(actor) {
    const [x, y] = actor.get_transformed_position();
    const [width, height] = actor.get_transformed_size();
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), x + width / 2, y + height / 2);
    await Scripting.sleep(200);
}

async function click(actor) {
    await hover(actor);
    pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
    await Scripting.sleep(80);
    pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    await Scripting.sleep(400);
}

async function waitFor(predicate, timeoutMs) {
    for (let waited = 0; waited < timeoutMs; waited += 250) {
        if (predicate())
            return true;
        await Scripting.sleep(250);
    }

    return predicate();
}

export async function run() {
    seed();
    const interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    interfaceSettings.set_string('color-scheme', 'prefer-dark');

    await waitFor(() => Main.panel.statusArea[UUID], 10000);
    const indicator = Main.panel.statusArea[UUID];
    const extension = Main.extensionManager.lookup(UUID);
    check(Boolean(indicator), `the indicator is in the top bar (state ${extension?.state}, error ${extension?.error})`);
    if (!indicator)
        return;

    check(await waitFor(() => indicator._active.size === 3, 8000),
        `three threads in progress (got ${indicator._active.size})`);
    check(indicator._suggested.size === 2, 'two suggestions');
    check(indicator._badge.text === '3', `the badge counts the threads in progress (got ${indicator._badge.text})`);
    check(indicator._pending.visible, 'the pending dot shows while suggestions wait');

    interfaceSettings.set_boolean('enable-hot-corners', false);
    await hover(indicator);
    await Scripting.sleep(1000);
    await shoot(Main.panel._rightBox, 'panel');

    indicator.menu.open();
    await Scripting.sleep(600);
    await shoot(indicator.menu.actor, 'menu-dark');

    // An agent suggests while the menu is open: the folder monitor picks it up.
    GLib.file_set_contents(`${DIR}/sug3.json`, JSON.stringify({
        id: 'sug3', title: 'Atualizar as notas da sessão', project: 'notas', origin: 'hermes',
        status: 'suggested', createdAt: ago(0), updatedAt: ago(0),
    }));
    check(await waitFor(() => indicator._suggested.size === 3, 4000), 'a new suggestion file appears in the menu');

    const suggestion = indicator._suggested.row('sug1');
    await click(suggestion._approve);
    check(indicator.menu.isOpen, 'approving leaves the menu open');
    check(await waitFor(() => readFile('sug1')?.status === 'active', 3000), 'approving writes the thread as active');
    check(await waitFor(() => indicator._active.size === 4, 3000), 'the approved thread joins the threads in progress');

    await click(indicator._suggested.row('sug2')._reject);
    check(await waitFor(() => readFile('sug2') === null, 3000), 'rejecting deletes the suggestion');

    const row = indicator._active.row('act3');
    await click(row._check);
    check(indicator.menu.isOpen, 'ticking a thread off leaves the menu open');
    check(await waitFor(() => readFile('act3')?.status === 'done', 3000), 'ticking writes the thread as done');

    await click(indicator._doneToggle);
    check(indicator._done.size === 2, `the done fold lists this week's two (got ${indicator._done.size})`);

    await click(indicator._addButton);
    check(indicator._addRow.visible, 'the + button shows the quick-add line');
    indicator._entry.text = 'Preparar a demo #website // slides 3 a 5';
    indicator._entry.clutter_text.emit('activate');
    await Scripting.sleep(600);
    const added = indicator._items.find(item => item.title === 'Preparar a demo');
    check(added?.project === 'website' && added?.next === 'slides 3 a 5', 'quick add reads #projeto and // next step');
    check(added && readFile(added.id)?.origin === 'jaime', 'quick add writes a thread by Jaime');

    await hover(indicator._active.row('act1'));
    await shoot(indicator.menu.actor, 'menu-dark-after');

    interfaceSettings.set_string('color-scheme', 'prefer-light');
    await Scripting.sleep(1500);
    if (!indicator.menu.isOpen) {
        indicator.menu.open();
        await Scripting.sleep(600);
    }
    await shoot(indicator.menu.actor, 'menu-light');

    const items = indicator._items;
    indicator._items = [];
    indicator._addRow.visible = false;
    indicator._render();
    await Scripting.sleep(300);
    await shoot(indicator.menu.actor, 'menu-empty');
    indicator._items = items;
    indicator._render();

    indicator.menu.close();
    await Scripting.sleep(300);
}

export function finish() {
    if (failures.length > 0)
        throw new Error(`Failed: ${failures.join('; ')}`);
}
