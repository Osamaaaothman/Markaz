// Placeholder worker process — docs/02-ARCHITECTURE-RULES.md §6: "The worker is a
// separate process from the API, even in Compose." Kept as its own process from M0
// so nothing ever has to be retrofitted to split it out later. Real BullMQ job
// consumers land in M3 (docs/14-MILESTONES.md) — this does no work yet.
process.stdout.write("[worker] placeholder — no jobs wired yet (see M3)\n");

// Keep the process alive rather than exiting immediately, so `docker compose up`
// reports a running (not crash-looping) worker container.
setInterval(() => {
  // intentionally empty
}, 60_000);
