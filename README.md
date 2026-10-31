# Fios

Extensão GNOME Shell (49–51) que mostra na top bar o trabalho **em curso**. Os
agentes (Claude, Codex, Antigravity, Hermes) sugerem fios com o comando `fio`;
o Jaime aprova ou rejeita no menu (ou na notificação), marca como feito e
reabre.

Cada fio tem um título, o projeto (com cor), o próximo passo, a origem (J, C,
X, A, H) e um link opcional (URL ou pasta) que o clique na linha abre.

## Instalar

```sh
make install   # extensão + ~/.local/bin/fio
make enable    # no Wayland, só depois de terminar sessão e voltar a entrar
```

Preferências (`gnome-extensions prefs fios@jmonjardino.dev`): posição na top
bar (esquerda, centro ou direita), atalho (por omissão `Super+.`) e notificações.

## Comando `fio`

```sh
fio propor "Corrigir o lint do PR 42" --agente claude --projeto website \
    --proximo "ver o log do CI" --link https://github.com/…/pull/42
fio listar [--todos] [--json]
fio atualizar ID --proximo "…"
fio adicionar "…" · fio aprovar ID · fio rejeitar ID
fio feito ID · fio reabrir ID · fio remover ID · fio limpar
```

Corre com GJS, por isso funciona em shells sem Node. O ID aceita um prefixo
único. Há no máximo 5 sugestões à espera e os títulos repetidos são recusados.

## Dados

Um ficheiro JSON por fio em `~/.local/share/fios/items` (`FIOS_DIR` muda a
pasta). Assim o menu e vários agentes escrevem ao mesmo tempo sem lock; cada
escrita substitui o ficheiro de forma atómica e o menu atualiza-se pelo
monitor da pasta. Os feitos aparecem 7 dias e o `fio limpar` apaga os que têm
mais de 30.

## Desenvolvimento

```sh
make test        # testes do modelo (Node)
make test-shell  # GNOME Shell headless: clica no menu e tira capturas em build/shots
```

`model.js` é puro e partilhado pela extensão, pelo CLI e pelos testes;
`store.js` trata do disco com Gio; as folhas `stylesheet-dark.css` e
`stylesheet-light.css` são geradas a partir de `styles/`.
