// SPDX-License-Identifier: GPL-3.0-or-later
//
// `fio`: the threads from the terminal. Agents suggest with `fio propor`;
// Jaime approves in the top bar menu (or here with `fio aprovar`).
// Runs with GJS (`gjs -m`), so it works in shells without Node.

import system from 'system';

import {
    AGENTS,
    MAX_PENDING,
    ORIGINS,
    arrange,
    findById,
    findDuplicate,
    isStale,
    makeItem,
    relativeTime,
    transition,
    update,
} from './model.js';
import {readAllSync, removeSync, writeSync} from './store.js';

const HELP = `fio — os fios em curso (extensão Fios na top bar)

Agentes (sugerem; o Jaime aprova na top bar):
  fio propor "título" --agente claude|codex|antigravity|hermes
             [--projeto P] [--proximo "próximo passo"] [--link URL|/caminho]
  fio atualizar ID [--proximo T] [--titulo T] [--projeto P] [--link L]

Jaime:
  fio adicionar "título" [--projeto P] [--proximo T] [--link L]
  fio aprovar ID · fio rejeitar ID
  fio feito ID · fio reabrir ID · fio remover ID
  fio limpar          apaga os feitos com mais de 30 dias

Todos:
  fio listar [--todos] [--json]

O ID aceita um prefixo único. Títulos até 90 caracteres, próximo passo até 120.`;

const FLAGS = {
    '--agente': 'agent',
    '--projeto': 'project',
    '--proximo': 'next',
    '--próximo': 'next',
    '--link': 'link',
    '--titulo': 'title',
    '--título': 'title',
};

function parseArgs(args) {
    const positional = [];
    const options = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--json' || arg === '--todos') {
            options[arg.slice(2)] = true;
        } else if (arg.startsWith('--')) {
            const [flag, inline] = arg.split(/=(.*)/s);
            const key = FLAGS[flag];
            if (!key)
                throw new Error(`Opção desconhecida: ${flag}. Vê \`fio ajuda\`.`);
            const value = inline ?? args[++i];
            if (value === undefined)
                throw new Error(`Falta o valor de ${flag}.`);
            options[key] = value;
        } else {
            positional.push(arg);
        }
    }

    return {positional, options};
}

function fieldsFrom(options) {
    const fields = {};
    for (const key of ['title', 'project', 'next', 'link']) {
        if (options[key] !== undefined)
            fields[key] = options[key];
    }

    return fields;
}

function line(item, now) {
    const origin = ORIGINS[item.origin].label;
    const project = item.project ? ` #${item.project}` : '';
    const next = item.next ? `\n          → ${item.next}` : '';

    return `  ${item.id}  ${item.title}${project}  (${origin}, ${relativeTime(item.updatedAt, now)})${next}`;
}

function list(items, options) {
    const now = Date.now();
    if (options.json) {
        const shown = options.todos ? items : items.filter(item => item.status !== 'done');
        print(JSON.stringify(shown, null, 2));

        return;
    }
    const {suggested, active, done} = arrange(items, now);
    const sections = [['Sugestões à espera', suggested], ['Em curso', active]];
    if (options.todos)
        sections.push(['Feitos (últimos 7 dias)', done]);
    let printed = false;
    for (const [title, members] of sections) {
        if (members.length === 0)
            continue;
        print(`${title}:`);
        for (const item of members)
            print(line(item, now));
        printed = true;
    }
    if (!printed)
        print('Nenhum fio em curso.');
}

function requireTitle(positional) {
    const title = positional.join(' ');
    if (!title)
        throw new Error('Falta o título, entre aspas.');

    return title;
}

function propose(items, positional, options) {
    const agent = options.agent?.toLowerCase();
    if (!agent || !AGENTS.includes(agent))
        throw new Error(`\`fio propor\` precisa de --agente (${AGENTS.join(', ')}).`);
    const title = requireTitle(positional);
    const duplicate = findDuplicate(items, title);
    if (duplicate) {
        print(`Já existe: ${duplicate.id} (${duplicate.status}). Usa \`fio atualizar ${duplicate.id}\` para mudar o próximo passo.`);

        return;
    }
    const pending = items.filter(item => item.status === 'suggested').length;
    if (pending >= MAX_PENDING)
        throw new Error(`Já há ${pending} sugestões à espera do Jaime. Não proponhas mais até ele as rever.`);
    const item = makeItem({...fieldsFrom(options), title}, {origin: agent});
    writeSync(item);
    print(`Sugestão ${item.id} criada; aparece na top bar para o Jaime aprovar.`);
}

function add(items, positional, options) {
    const title = requireTitle(positional);
    const duplicate = findDuplicate(items, title);
    if (duplicate)
        throw new Error(`Já existe: ${duplicate.id} (${duplicate.status}).`);
    const item = makeItem({...fieldsFrom(options), title}, {origin: 'jaime'});
    writeSync(item);
    print(`Fio ${item.id} adicionado.`);
}

function target(items, positional) {
    if (!positional[0])
        throw new Error('Falta o ID do fio (vê `fio listar`).');

    return findById(items, positional[0]);
}

const MOVES = {aprovar: 'approve', feito: 'done', reabrir: 'reopen'};
const DONE_MESSAGES = {approve: 'aprovado', done: 'marcado como feito', reopen: 'reaberto'};

function main(args) {
    const [command = 'listar', ...rest] = args;
    const {positional, options} = parseArgs(rest);
    const items = readAllSync();

    switch (command) {
    case 'ajuda':
    case 'help':
    case '-h':
    case '--help':
        print(HELP);
        break;
    case 'listar':
    case 'ls':
        list(items, options);
        break;
    case 'propor':
        propose(items, positional, options);
        break;
    case 'adicionar':
        add(items, positional, options);
        break;
    case 'atualizar': {
        const fields = fieldsFrom(options);
        if (Object.keys(fields).length === 0)
            throw new Error('Diz o que muda: --proximo, --titulo, --projeto ou --link.');
        const item = update(target(items, positional), fields);
        writeSync(item);
        print(`Fio ${item.id} atualizado.`);
        break;
    }
    case 'aprovar':
    case 'feito':
    case 'reabrir': {
        const action = MOVES[command];
        const item = transition(target(items, positional), action);
        writeSync(item);
        print(`Fio ${item.id} ${DONE_MESSAGES[action]}.`);
        break;
    }
    case 'rejeitar': {
        const item = target(items, positional);
        if (item.status !== 'suggested')
            throw new Error(`O fio ${item.id} não é uma sugestão; para o apagar usa \`fio remover\`.`);
        removeSync(item.id);
        print(`Sugestão ${item.id} rejeitada.`);
        break;
    }
    case 'remover':
    case 'rm': {
        const item = target(items, positional);
        removeSync(item.id);
        print(`Fio ${item.id} removido.`);
        break;
    }
    case 'limpar': {
        const stale = items.filter(item => isStale(item));
        for (const item of stale)
            removeSync(item.id);
        print(stale.length === 1 ? '1 fio antigo apagado.' : `${stale.length} fios antigos apagados.`);
        break;
    }
    default:
        throw new Error(`Comando desconhecido: ${command}. Vê \`fio ajuda\`.`);
    }
}

try {
    main(system.programArgs);
} catch (error) {
    printerr(`fio: ${error.message}`);
    system.exit(1);
}

