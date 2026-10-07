// Module-local copies of the engine/numbering instances, for the same reason as inventory.tokens.ts:
// both are stateless wrappers over PrismaService, and sharing another module's providers would
// couple two independent modules.
export const PURCHASING_ENGINE = Symbol("IAccountingEngine (purchasing)");
export const PURCHASING_NUMBERING = Symbol("INumberingService (purchasing)");
