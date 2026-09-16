UUID = nazar-gnome@xfurqan0.github.io
ZIP = $(UUID).shell-extension.zip

.PHONY: check zip install clean

# Every rule this extension has, under plain gjs. No session, no panel, no clock but the
# one the suite passes in.
check:
	gjs -m tests/run.js

# `gnome-extensions pack` takes extension.js, metadata.json and stylesheet.css by itself and
# nothing else, so the bead and the contract module have to be named. An extension that
# packs without them installs cleanly and comes up without an icon, which is the quiet
# version of this mistake and the reason it is worth a comment.
zip: check
	gnome-extensions pack --force --extra-source=lib --extra-source=assets .

install: zip
	gnome-extensions install --force $(ZIP)
	@echo "Installed. Log out and back in, then: gnome-extensions enable $(UUID)"

clean:
	rm -f $(ZIP)
