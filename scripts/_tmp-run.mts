for (const suite of process.argv.slice(2)) {
  try { const mod = await import(`./verify/${suite}`); if (mod.default instanceof Promise) await mod.default; console.log("ok", suite); }
  catch (err) { console.log("FAILED", suite, String(err instanceof Error ? err.message : err).slice(0, 160)); }
}
process.exit(0);
