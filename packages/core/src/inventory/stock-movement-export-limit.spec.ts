import { PrismaClient } from "@erp/db";
import { StockMovementService, StockMovementExportLimitError, STOCK_MOVEMENT_EXPORT_LIMIT } from "./stock-movement.service.js";

it("rejects oversized movement exports instead of silently delivering an incomplete report", async () => {
  const prisma = new PrismaClient();
  const find = jest.spyOn(prisma.stockMovement, "findMany");
  // The guard must run before resolving document details; no DB connection is opened.
  find.mockResolvedValue(Array.from<Awaited<ReturnType<typeof prisma.stockMovement.findMany>>[number]>({ length: STOCK_MOVEMENT_EXPORT_LIMIT + 1 }));
  try {
    await expect(new StockMovementService(prisma).listForExport("company", {})).rejects.toBeInstanceOf(StockMovementExportLimitError);
  } finally {
    find.mockRestore();
    await prisma.$disconnect();
  }
});
