# R436 — Terminal scope cleanup

RM 0-1-3 ends the game immediately. Ending a game now clears running programs, parked skill-play scopes and the resolving motion, alongside the existing pending queue cleanup. Previously, a parked Counter window could restore its parent in the over phase and overwrite the original unsupported outcome or continue an already-ended game.

Six both-seat native cases save and reload nested Counter scopes, then exercise a staged malformed retained-source interruption, an actual synthetic Counter win instruction, and native concession. They assert the original outcome and source, one game-over event, no remaining programs/scopes/resolving motion, and no resumed parent play. The malformed-source mutation is a saved-state fault control; the winning Counter is a protocol fixture, not a claim about a printed card. No compiler or stored-record delta.

Validation: terminal6, existing scope94, after-window14, retained152 and outcomes passed; TypeScript passed. The combined compiler batch is validated separately.
