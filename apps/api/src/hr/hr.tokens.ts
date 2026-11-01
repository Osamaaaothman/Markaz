// Module-local copies of the engine instance, for the same reason as purchasing.tokens.ts: a
// stateless wrapper over PrismaService, and sharing another module's providers would couple two
// independent modules.
export const HR_ENGINE = Symbol("IAccountingEngine (hr)");
export const HR_NUMBERING = Symbol("INumberingService (hr)");
