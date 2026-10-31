// SPDX-License-Identifier: GPL-3.0-or-later

import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
    MAX_PENDING,
    TONES,
    arrange,
    findById,
    findDuplicate,
    isStale,
    linkUri,
    makeItem,
    newId,
    normalize,
    parseQuickAdd,
    projectTone,
    relativeTime,
    slugProject,
    summary,
    transition,
    update,
} from '../model.js';

const NOW = Date.parse('2026-10-31T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

test('slugProject lowercases, drops accents and the leading #', () => {
    assert.equal(slugProject('#Ação-Social'), 'acao-social');
    assert.equal(slugProject('  Side Project  '), 'side-project');
    assert.equal(slugProject(undefined), '');
});

test('projectTone gives each project a stable tone', () => {
    assert.equal(projectTone(''), 'none');
    assert.equal(projectTone('website'), projectTone('website'));
    assert.ok(TONES.includes(projectTone('website')));
});

test('newId is short, lowercase base36', () => {
    const id = newId(NOW, () => 0.5);
    assert.match(id, /^[a-z0-9]{7}$/);
    assert.notEqual(newId(NOW, () => 0.1), newId(NOW, () => 0.9));
});

test('makeItem: Jaime adds active threads, agents suggest', () => {
    const mine = makeItem({title: '  Rever   proposta ', project: 'Website'}, {now: NOW});
    assert.equal(mine.title, 'Rever proposta');
    assert.equal(mine.project, 'website');
    assert.equal(mine.status, 'active');
    assert.equal(mine.origin, 'jaime');

    const theirs = makeItem({title: 'Corrigir CI'}, {origin: 'claude', now: NOW});
    assert.equal(theirs.status, 'suggested');
    assert.equal(theirs.createdAt, '2026-10-31T12:00:00.000Z');
});

test('makeItem refuses empty titles, long fields, unknown origins and bad links', () => {
    assert.throws(() => makeItem({title: '   '}), /título/);
    assert.throws(() => makeItem({title: 'x'.repeat(91)}), /Título demasiado longo/);
    assert.throws(() => makeItem({title: 'a', next: 'x'.repeat(121)}), /Próximo passo/);
    assert.throws(() => makeItem({title: 'a'}, {origin: 'gemini'}), /Origem desconhecida/);
    assert.throws(() => makeItem({title: 'a', link: 'dev/fios'}), /link/);
});

test('normalize repairs partial files and rejects junk', () => {
    assert.equal(normalize(null), null);
    assert.equal(normalize({id: 'a1'}), null);
    const item = normalize({id: 'a1', title: 'X', origin: 'nope', status: 'weird'});
    assert.equal(item.origin, 'jaime');
    assert.equal(item.status, 'active');
    assert.equal(item.project, '');
});

test('transition moves through approve, done and reopen', () => {
    const suggested = makeItem({title: 'a'}, {origin: 'codex', now: NOW});
    const active = transition(suggested, 'approve', NOW + 1000);
    assert.equal(active.status, 'active');
    const done = transition(active, 'done', NOW + 2000);
    assert.equal(done.status, 'done');
    assert.equal(done.doneAt, new Date(NOW + 2000).toISOString());
    const reopened = transition(done, 'reopen', NOW + 3000);
    assert.equal(reopened.status, 'active');
    assert.equal(reopened.doneAt, null);
    assert.throws(() => transition(active, 'approve'), /não pode passar/);
    assert.throws(() => transition(active, 'fly'), /desconhecida/);
});

test('update changes only the given fields and validates them', () => {
    const item = makeItem({title: 'a', next: 'b'}, {now: NOW});
    const changed = update(item, {next: 'c'}, NOW + 1);
    assert.equal(changed.next, 'c');
    assert.equal(changed.title, 'a');
    assert.throws(() => update(item, {title: ''}), /título/);
});

test('arrange: suggestions oldest first, active newest first, recent done only', () => {
    const at = (offset, fields, options) => makeItem(fields, {now: NOW + offset, ...options});
    const items = [
        at(0, {title: 's1'}, {origin: 'claude'}),
        at(-5000, {title: 's0'}, {origin: 'claude'}),
        at(-9000, {title: 'a-old'}),
        at(-1000, {title: 'a-new'}),
        {...at(0, {title: 'd-recent'}), status: 'done', doneAt: new Date(NOW - DAY).toISOString()},
        {...at(0, {title: 'd-old'}), status: 'done', doneAt: new Date(NOW - 8 * DAY).toISOString()},
    ];
    const lists = arrange(items, NOW);
    assert.deepEqual(lists.suggested.map(item => item.title), ['s0', 's1']);
    assert.deepEqual(lists.active.map(item => item.title), ['a-new', 'a-old']);
    assert.deepEqual(lists.done.map(item => item.title), ['d-recent']);
    assert.equal(summary(lists), '2 em curso · 2 sugestões');
});

test('isStale only flags done threads older than the keep window', () => {
    const item = makeItem({title: 'a'}, {now: NOW});
    assert.equal(isStale(item, NOW), false);
    assert.equal(isStale({...item, status: 'done', doneAt: new Date(NOW - 31 * DAY).toISOString()}, NOW), true);
});

test('findDuplicate matches open threads by title, ignoring case and accents', () => {
    const items = [makeItem({title: 'Rever Proposta'}), {...makeItem({title: 'Fechado'}), status: 'done'}];
    assert.ok(findDuplicate(items, 'rever proposta'));
    assert.equal(findDuplicate(items, 'fechado'), null);
});

test('findById accepts unique prefixes', () => {
    const items = [{id: 'abc111'}, {id: 'abd222'}];
    assert.equal(findById(items, 'abc').id, 'abc111');
    assert.throws(() => findById(items, 'ab'), /ambíguo/);
    assert.throws(() => findById(items, 'zz'), /Não há/);
});

test('parseQuickAdd reads #projeto and // next step', () => {
    assert.deepEqual(parseQuickAdd('Rever proposta #Website // ligar ao cliente'),
        {title: 'Rever proposta', project: 'website', next: 'ligar ao cliente'});
    assert.deepEqual(parseQuickAdd('#ae Reunião'), {title: 'Reunião', project: 'ae', next: ''});
    assert.deepEqual(parseQuickAdd('Só título'), {title: 'Só título', project: '', next: ''});
});

test('linkUri opens URLs as they are and paths as file URIs', () => {
    assert.equal(linkUri('https://github.com/x/y/pull/1', '/home/j'), 'https://github.com/x/y/pull/1');
    assert.equal(linkUri('~/dev/fios', '/home/j'), 'file:///home/j/dev/fios');
    assert.equal(linkUri('/tmp/a b', '/home/j'), 'file:///tmp/a%20b');
    assert.equal(linkUri('dev/fios', '/home/j'), null);
    assert.equal(linkUri('', '/home/j'), null);
});

test('relativeTime speaks Portuguese', () => {
    const ago = ms => new Date(NOW - ms).toISOString();
    assert.equal(relativeTime(ago(10_000), NOW), 'agora');
    assert.equal(relativeTime(ago(5 * 60_000), NOW), 'há 5 min');
    assert.equal(relativeTime(ago(3 * 3_600_000), NOW), 'há 3 h');
    assert.equal(relativeTime(ago(DAY + 1), NOW), 'ontem');
    assert.equal(relativeTime(ago(4 * DAY), NOW), 'há 4 dias');
});

test('MAX_PENDING stays small', () => {
    assert.ok(MAX_PENDING <= 10);
});
