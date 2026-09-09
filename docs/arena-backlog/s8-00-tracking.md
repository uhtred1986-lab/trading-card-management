---
title: Arena Stage 8 tracking — everything else from configuration
milestone: Arena M11 — Everything else from config (Stage 8)
labels: epic, backlog, area:arena-vm, area:arena-ui, area:arena-workbench, phase:rules-stage8
stage: 8
tracking: true
---
Stage 8 of the rules-language programme (Sonnet 5, size M). What is still TypeScript *about DBS* — the words the board uses, the questions a prompt asks, the glossary, the room lighting, the model's primer, the probe fixtures — reads from the definition when a game is on the rules engine; the AI plays on it; and the definition itself is visible in the app.

**Exit criterion:** a grep of `src/lib/arena` outside `engine/` for a DBS zone name, colour name or keyword name finds only the legacy engine's own files and the definition; the Claude opponent and the referee play a rules-engine game; `/arena/rules/game` shows the `.rules` files.

Child issues:

{{children}}
