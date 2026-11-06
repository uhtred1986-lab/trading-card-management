# Sequential Combo cleanup retains movement-time skills

P-656 #10 could activate after its skills were negated in Combo: sequential 8-5-8 cleanup reset its effects on departure, then 8-5-9 read the new Drop occurrence without the original movement history. The simultaneous R513 path already retained that history. RM 9-6-9-2 explicitly forbids a movement Auto from triggering when it was negated in its original area.

The sequential writer now captures the existing R499 receipt at the actual movement boundary, after replacement selection and before cleanup. Both interpreter and flow substitute writers retain the receipt from their actual Combo-to-Drop move. The later special occurrence consumes that saved history; a saved occurrence without it is refused instead of reconstructed from Drop. Combo-entry provenance and the original special timing remain unchanged. Missing-history saved cleanup is conservatively refused even for a mundane subject with no matching Auto; no migration reconstructs its old state.

The original `played-combo-end-5.ts` expected-zero negation assertions remain unchanged. Additional controls use real native Combo entry and an explicitly staged 8-5-8 checkpoint, then actual direct, interpreter, and flow writers, for both seats with and without negation. Substitute receipts survive JSON save/reload; missing receipts refuse. These are replacement-writer mechanism controls, not admission of a new printed replacement card.

This repair is independent of R528 native standing integration. It depends only on existing R499 movement history, R485 special Combo timing, and R513 cleanup structures.

Focused validation: 12 direct/substitute receipt cases and both unchanged original P-656 negation assertions pass; TypeScript and focused ESLint pass. The complete extended played/Combo suite remains running at commit time; no combined-gate success is claimed.

Substitute preflight follow-up: both native writers explicitly include the later `cleanupSpecial` moment when validating unresolved original bodies. The existing broad `comboed` movement alias already matched ordinary copied lines; the explicit moment preserves the actual later-trigger contract rather than relying on that alias. Eight additional controls cover both seats, interpreter/flow writers, copied full P-656 #10 and an explicitly synthetic granted-keyword trigger. All refuse before state or event writes. These eight controls, TypeScript and focused lint pass.
