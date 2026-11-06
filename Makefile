UUID := fios@jmonjardino.dev
BUILD := build
PACKAGE := $(BUILD)/$(UUID).shell-extension.zip
SCHEMA := schemas/org.gnome.shell.extensions.fios.gschema.xml
SOURCES := extension.js indicator.js alerts.js widgets.js prefs.js model.js store.js metadata.json $(SCHEMA) icons/fios-symbolic.svg
STYLES := $(BUILD)/stylesheet-dark.css $(BUILD)/stylesheet-light.css
SHOTS ?= $(BUILD)/shots
CLI_DIR := $(HOME)/.local/share/fios/cli
BIN := $(HOME)/.local/bin/fio

.PHONY: all test test-shell pack install install-cli enable uninstall clean

all: pack

test:
	node --test tests/*.test.js

$(BUILD)/stylesheet-%.css: styles/base.css styles/%.css
	mkdir -p $(BUILD)
	cat $^ > $@

pack: $(PACKAGE)

$(PACKAGE): $(SOURCES) $(STYLES)
	gnome-extensions pack --force --out-dir=$(BUILD) --schema=$(SCHEMA) \
		--extra-source=indicator.js --extra-source=alerts.js --extra-source=widgets.js --extra-source=model.js --extra-source=store.js \
		--extra-source=icons \
		--extra-source=$(BUILD)/stylesheet-dark.css --extra-source=$(BUILD)/stylesheet-light.css .

# Runs the extension in a headless GNOME Shell with its own settings and a
# throwaway threads folder, clicks through the menu and screenshots each
# state in $(SHOTS). The test Shell shares the runtime folder with the real
# one: the crash guard it leaves there would make a crash of the real Shell
# turn every extension off, so it is removed when the test ends.
CRASH_GUARD := $(XDG_RUNTIME_DIR)/gnome-shell-disable-extensions

test-shell: pack
	rm -rf $(SHOTS) && mkdir -p $(SHOTS)/items
	FIOS_DIR=$(abspath $(SHOTS))/items FIOS_SHOTS=$(abspath $(SHOTS)) \
		dbus-run-session -- gnome-shell-test-tool --headless --disable-animations \
		--extension $(PACKAGE) tests/shell-preview.js; \
		status=$$?; \
		test -e $(CRASH_GUARD) && test $$(( $$(date +%s) - $$(stat -c %Y $(CRASH_GUARD)) )) -lt 600 \
			&& rm -f $(CRASH_GUARD); exit $$status

install: pack install-cli
	gnome-extensions install --force $(PACKAGE)

# The `fio` command runs with GJS, so agents' shells need no Node.
install-cli:
	mkdir -p $(CLI_DIR) $(dir $(BIN))
	cp fio.js model.js store.js $(CLI_DIR)/
	printf '#!/bin/sh\nexec gjs -m "%s/fio.js" "$$@"\n' "$(CLI_DIR)" > $(BIN)
	chmod +x $(BIN)

# On Wayland the Shell finds a newly installed extension at the next login.
enable:
	gnome-extensions enable $(UUID)

uninstall:
	gnome-extensions uninstall $(UUID)
	rm -rf $(CLI_DIR) $(BIN)

clean:
	rm -rf $(BUILD)
