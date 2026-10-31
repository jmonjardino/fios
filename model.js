// SPDX-License-Identifier: GPL-3.0-or-later
//
// What a thread is and what can happen to it. Pure: no GNOME imports, so the
// extension, the `fio` command and the Node tests all share it.

export const STATUSES = ['suggested', 'active', 'done'];

export const ORIGINS = {
    jaime: {label: 'Jaime', letter: 'J'},
    claude: {label: 'Claude', letter: 'C'},
    codex: {label: 'Codex', letter: 'X'},
    antigravity: {label: 'Antigravity', letter: 'A'},
    hermes: {label: 'Hermes', letter: 'H'},
};

export const AGENTS = Object.keys(ORIGINS).filter(origin => origin !== 'jaime');

export const LIMITS = {title: 90, project: 24, next: 120, link: 500};

// Suggestions waiting at once: past this, `fio propor` refuses, so a chatty
// agent cannot bury the real threads.
export const MAX_PENDING = 5;

// Done threads stay listed this long, and on disk until `fio limpar`.
export const DONE_VISIBLE_DAYS = 7;
export const DONE_VISIBLE_MAX = 5;
export const DONE_KEEP_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export const TONES = ['violet', 'sky', 'green', 'orange', 'rose', 'blue', 'amber', 'teal'];

export function slugProject(text) {
    return String(text ?? '')
        .trim()
        .replace(/^#/, '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export function projectTone(project) {
    if (!project)
        return 'none';
    let hash = 0;
    for (const char of project)
        hash = (hash * 31 + char.codePointAt(0)) >>> 0;

    return TONES[hash % TONES.length];
}

export function newId(now = Date.now(), random = Math.random) {
    const time = now.toString(36).slice(-4);
    const tail = Math.floor(random() * 36 ** 3).toString(36).padStart(3, '0');

    return `${time}${tail}`;
}

function clean(text) {
    return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function checkLength(field, value, label) {
    if (value.length > LIMITS[field])
        throw new Error(`${label} demasiado longo (${value.length} caracteres; máximo ${LIMITS[field]}).`);
}

/** Validated, normalised fields; throws an Error with a message fit to show. */
export function cleanFields({title, project, next, link} = {}) {
    const fields = {};
    if (title !== undefined) {
        fields.title = clean(title);
        if (!fields.title)
            throw new Error('O fio precisa de um título.');
        checkLength('title', fields.title, 'Título');
    }
    if (project !== undefined) {
        fields.project = slugProject(project);
        checkLength('project', fields.project, 'Projeto');
    }
    if (next !== undefined) {
        fields.next = clean(next);
        checkLength('next', fields.next, 'Próximo passo');
    }
    if (link !== undefined) {
        fields.link = clean(link);
        checkLength('link', fields.link, 'Link');
        if (fields.link && !linkUri(fields.link, '/'))
            throw new Error('O link tem de ser um URL http(s) ou um caminho absoluto (/… ou ~/…).');
    }

    return fields;
}

export function makeItem(fields, {origin = 'jaime', status, now = Date.now(), id} = {}) {
    if (!ORIGINS[origin])
        throw new Error(`Origem desconhecida: ${origin}. Usa uma de: ${Object.keys(ORIGINS).join(', ')}.`);
    const cleaned = cleanFields({project: '', next: '', link: '', ...fields});
    if (cleaned.title === undefined)
        throw new Error('O fio precisa de um título.');
    const stamp = new Date(now).toISOString();

    return {
        id: id ?? newId(now),
        title: cleaned.title,
        project: cleaned.project,
        next: cleaned.next,
        link: cleaned.link,
        origin,
        status: status ?? (origin === 'jaime' ? 'active' : 'suggested'),
        createdAt: stamp,
        updatedAt: stamp,
        doneAt: null,
    };
}

/** A thread read from disk, made whole, or null if it is not one. */
export function normalize(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id)
        return null;
    const title = clean(raw.title);
    if (!title)
        return null;

    return {
        id: raw.id,
        title,
        project: slugProject(raw.project),
        next: clean(raw.next),
        link: clean(raw.link),
        origin: ORIGINS[raw.origin] ? raw.origin : 'jaime',
        status: STATUSES.includes(raw.status) ? raw.status : 'active',
        createdAt: raw.createdAt ?? new Date(0).toISOString(),
        updatedAt: raw.updatedAt ?? raw.createdAt ?? new Date(0).toISOString(),
        doneAt: raw.doneAt ?? null,
    };
}

const MOVES = {
    approve: {from: ['suggested'], to: 'active'},
    done: {from: ['active', 'suggested'], to: 'done'},
    reopen: {from: ['done'], to: 'active'},
};

/** The thread after `action`; throws when the action does not apply. */
export function transition(item, action, now = Date.now()) {
    const move = MOVES[action];
    if (!move)
        throw new Error(`Ação desconhecida: ${action}.`);
    if (!move.from.includes(item.status))
        throw new Error(`O fio ${item.id} está "${item.status}" e não pode passar a "${move.to}".`);
    const stamp = new Date(now).toISOString();

    return {...item, status: move.to, updatedAt: stamp, doneAt: move.to === 'done' ? stamp : null};
}

export function update(item, fields, now = Date.now()) {
    return {...item, ...cleanFields(fields), updatedAt: new Date(now).toISOString()};
}

function time(iso) {
    const value = Date.parse(iso);

    return Number.isNaN(value) ? 0 : value;
}

/** The three lists the menu shows, each in its order. */
export function arrange(items, now = Date.now()) {
    const suggested = items.filter(item => item.status === 'suggested')
        .sort((a, b) => time(a.createdAt) - time(b.createdAt));
    const active = items.filter(item => item.status === 'active')
        .sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
    const done = items.filter(item => item.status === 'done' && now - time(item.doneAt) < DONE_VISIBLE_DAYS * DAY_MS)
        .sort((a, b) => time(b.doneAt) - time(a.doneAt))
        .slice(0, DONE_VISIBLE_MAX);

    return {suggested, active, done};
}

export function isStale(item, now = Date.now()) {
    return item.status === 'done' && now - time(item.doneAt) >= DONE_KEEP_DAYS * DAY_MS;
}

function sameTitle(a, b) {
    return slugProject(a) === slugProject(b);
}

/** An open thread (suggested or active) with the same title, if any. */
export function findDuplicate(items, title) {
    return items.find(item => item.status !== 'done' && sameTitle(item.title, title)) ?? null;
}

/** The one thread whose id starts with `prefix`; throws if none or several. */
export function findById(items, prefix) {
    const matches = items.filter(item => item.id.startsWith(prefix));
    if (matches.length === 0)
        throw new Error(`Não há nenhum fio com o id ${prefix}.`);
    if (matches.length > 1)
        throw new Error(`O id ${prefix} é ambíguo: ${matches.map(item => item.id).join(', ')}.`);

    return matches[0];
}

/**
 * The quick-add line typed in the menu: `#projeto` anywhere sets the project,
 * and what follows `//` is the next step.
 */
export function parseQuickAdd(text) {
    let [head, ...rest] = String(text ?? '').split('//');
    let project = '';
    head = head.replace(/(^|\s)#([\p{L}\p{N}_-]+)/u, (_match, space, tag) => {
        project = tag;

        return space;
    });

    return {title: clean(head), project: slugProject(project), next: clean(rest.join('//'))};
}

/** A URI to open for a link: http(s) as is, absolute and ~ paths as file://. */
export function linkUri(link, home) {
    if (!link)
        return null;
    if (/^https?:\/\/\S+$/i.test(link))
        return link;
    let path = null;
    if (link.startsWith('/'))
        path = link;
    else if (link === '~' || link.startsWith('~/'))
        path = `${home.replace(/\/$/, '')}${link.slice(1)}`;
    if (!path)
        return null;

    return `file://${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function relativeTime(iso, now = Date.now()) {
    const minutes = Math.floor((now - time(iso)) / 60000);
    if (minutes < 1)
        return 'agora';
    if (minutes < 60)
        return `há ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `há ${hours} h`;
    const days = Math.floor(hours / 24);

    return days === 1 ? 'ontem' : `há ${days} dias`;
}

export function summary({suggested, active}) {
    const parts = [active.length === 1 ? '1 em curso' : `${active.length} em curso`];
    if (suggested.length > 0)
        parts.push(suggested.length === 1 ? '1 sugestão' : `${suggested.length} sugestões`);

    return parts.join(' · ');
}
