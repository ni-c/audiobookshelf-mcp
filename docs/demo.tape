# vhs script for the demo GIF: `vhs docs/demo.tape` writes docs/public/demo.gif
#
# Prerequisites:
#   * vhs (https://github.com/charmbracelet/vhs) and its ttyd/ffmpeg dependencies
#   * run from the REPO ROOT, not from docs/
#   * npm run build
#   * AUDIOBOOKSHELF_URL and AUDIOBOOKSHELF_API_KEY exported, pointing at an
#     instance with at least one collection. docs/demo.mjs only reads, plus the
#     first call of delete_collection, which returns a token and deletes nothing —
#     but recording against a throwaway instance is still the sane choice, because
#     the GIF shows real titles.
#
# Three beats: how many tools, what a compact projection looks like, and the
# confirmation-token gate. Inside a Hide block use vhs's own Sleep — the shell's
# `sleep` blocks the tape and the recording ends before any output appears.

Output docs/public/demo.gif

Set Shell "bash"
Set FontSize 17
Set Width 1260
Set Height 430
Set Padding 22
Set Theme "Catppuccin Mocha"
Set TypingSpeed 28ms

Hide
Type "clear" Enter
Sleep 400ms
Show

Type "node docs/demo.mjs"
Sleep 700ms
Enter
Sleep 9s
