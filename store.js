// SPDX-License-Identifier: GPL-3.0-or-later
//
// Threads on disk: one JSON file per thread in ~/.local/share/fios/items, so
// the extension and several agents can write at once without a lock. Each
// write goes to a temporary file that replaces the old one, so a reader never
// sees half a thread. FIOS_DIR points somewhere else, for the tests.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {normalize} from './model.js';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');
Gio._promisify(Gio.File.prototype, 'delete_async', 'delete_finish');
Gio._promisify(Gio.File.prototype, 'enumerate_children_async', 'enumerate_children_finish');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async', 'next_files_finish');

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export function itemsDir() {
    const path = GLib.getenv('FIOS_DIR') ||
        GLib.build_filenamev([GLib.get_user_data_dir(), 'fios', 'items']);

    return Gio.File.new_for_path(path);
}

function fileFor(dir, id) {
    if (!/^[a-z0-9]+$/.test(id))
        throw new Error(`Id inválido: ${id}`);

    return dir.get_child(`${id}.json`);
}

function parse(bytes) {
    try {
        return normalize(JSON.parse(decoder.decode(bytes)));
    } catch {
        return null;
    }
}

function serialise(item) {
    return encoder.encode(`${JSON.stringify(item, null, 2)}\n`);
}

function isJson(info) {
    const name = info.get_name();

    return name.endsWith('.json') && !name.startsWith('.');
}

// Synchronous, for the `fio` command.

export function readAllSync(dir = itemsDir()) {
    if (!dir.query_exists(null))
        return [];
    const items = [];
    const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    for (let info = enumerator.next_file(null); info; info = enumerator.next_file(null)) {
        if (!isJson(info))
            continue;
        try {
            const [, bytes] = dir.get_child(info.get_name()).load_contents(null);
            const item = parse(bytes);
            if (item)
                items.push(item);
        } catch {
            // Gone between listing and reading: another writer removed it.
        }
    }
    enumerator.close(null);

    return items;
}

export function writeSync(item, dir = itemsDir()) {
    if (!dir.query_exists(null))
        dir.make_directory_with_parents(null);
    fileFor(dir, item.id).replace_contents(serialise(item), null, false, Gio.FileCreateFlags.NONE, null);
}

export function removeSync(id, dir = itemsDir()) {
    fileFor(dir, id).delete(null);
}

// Asynchronous, for the Shell.

export async function readAll(dir = itemsDir(), cancellable = null) {
    let enumerator;
    try {
        enumerator = await dir.enumerate_children_async('standard::name',
            Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable);
    } catch (error) {
        if (error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            return [];
        throw error;
    }

    const names = [];
    for (;;) {
        const infos = await enumerator.next_files_async(50, GLib.PRIORITY_DEFAULT, cancellable);
        if (infos.length === 0)
            break;
        names.push(...infos.filter(isJson).map(info => info.get_name()));
    }

    const items = await Promise.all(names.map(async name => {
        try {
            const [bytes] = await dir.get_child(name).load_contents_async(cancellable);

            return parse(bytes);
        } catch {
            return null;
        }
    }));

    return items.filter(Boolean);
}

export async function write(item, dir = itemsDir()) {
    if (!dir.query_exists(null))
        dir.make_directory_with_parents(null);
    await fileFor(dir, item.id).replace_contents_bytes_async(
        GLib.Bytes.new(serialise(item)), null, false, Gio.FileCreateFlags.NONE, null);
}

export async function remove(id, dir = itemsDir()) {
    await fileFor(dir, id).delete_async(GLib.PRIORITY_DEFAULT, null);
}

/** Calls `onChange` (debounced) whenever a thread file changes; returns a stop function. */
export function watch(onChange, dir = itemsDir()) {
    if (!dir.query_exists(null))
        dir.make_directory_with_parents(null);
    const monitor = dir.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
    let timerId = 0;
    const handler = monitor.connect('changed', (_monitor, file, otherFile) => {
        const names = [file?.get_basename(), otherFile?.get_basename()];
        if (!names.some(name => name?.endsWith('.json')))
            return;
        if (timerId)
            GLib.Source.remove(timerId);
        timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            timerId = 0;
            onChange();

            return GLib.SOURCE_REMOVE;
        });
    });

    return () => {
        if (timerId)
            GLib.Source.remove(timerId);
        monitor.disconnect(handler);
        monitor.cancel();
    };
}
