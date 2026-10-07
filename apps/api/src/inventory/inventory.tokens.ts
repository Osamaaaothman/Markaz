// A second IAccountingEngine/INumberingService instance, local to this module — the
// accounting module's own tokens (ACCOUNTING_ENGINE, NUMBERING_SERVICE) are not exported for
// reuse, and both implementations are stateless wrappers over PrismaService, so a second
// instance is cheap and avoids coupling two otherwise-independent modules together.
export const INVENTORY_ENGINE = Symbol("IAccountingEngine (inventory)");
export const INVENTORY_NUMBERING = Symbol("INumberingService (inventory)");
