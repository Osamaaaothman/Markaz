import { Prisma, type PrismaClient } from "@erp/db";
import type { TransactionClient } from "../contracts.js";

export async function replenishmentRows(
  db: TransactionClient,
  companyId: string,
  warehouseId: string,
  itemIds?: readonly string[],
  cursor?: string,
) {
  const items = await db.item.findMany({
    where: {
      companyId,
      isActive: true,
      reorderPoint: { gt: 0 },
      ...(itemIds ? { id: { in: [...itemIds] } } : {}),
    },
    select: { id: true, code: true, name: true, nameAr: true, unit: true, reorderPoint: true },
    orderBy: { id: "asc" },
    take: 101,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const page = items.slice(0, 100);
  const ids = page.map((i) => i.id);
  const [stocks, requests, orders] = await Promise.all([
    db.itemWarehouseStock.findMany({
      where: { companyId, warehouseId, itemId: { in: ids } },
      select: { itemId: true, quantity: true },
      take: 100,
    }),
    db.purchaseRequestLine.groupBy({
      by: ["itemId"],
      where: {
        itemId: { in: ids },
        purchaseRequest: { companyId, warehouseId, status: { in: ["PENDING", "ACCEPTED"] } },
      },
      _sum: { quantity: true },
    }),
    db.purchaseOrderLine.groupBy({
      by: ["itemId"],
      where: {
        itemId: { in: ids },
        purchaseOrder: {
          companyId,
          warehouseId,
          status: { in: ["PENDING_APPROVAL", "APPROVED", "PARTIALLY_RECEIVED"] },
        },
      },
      _sum: { quantity: true, receivedQuantity: true },
    }),
  ]);
  const data = page.map((item) => {
    const stock = stocks.find((x) => x.itemId === item.id)?.quantity ?? new Prisma.Decimal(0);
    const requested =
      requests.find((x) => x.itemId === item.id)?._sum.quantity ?? new Prisma.Decimal(0);
    const order = orders.find((x) => x.itemId === item.id)?._sum;
    const incoming = (order?.quantity ?? new Prisma.Decimal(0)).minus(order?.receivedQuantity ?? 0);
    const suggested = Prisma.Decimal.max(
      0,
      item.reorderPoint.minus(stock).minus(requested).minus(incoming),
    );
    return {
      itemId: item.id,
      itemCode: item.code,
      itemName: item.name,
      itemNameAr: item.nameAr,
      unit: item.unit,
      onHand: stock.toFixed(4),
      target: item.reorderPoint.toFixed(4),
      requested: requested.toFixed(4),
      incoming: incoming.toFixed(4),
      suggested: suggested.toFixed(4),
    };
  });
  return {
    data,
    pageInfo: {
      hasMore: items.length > 100,
      nextCursor: items.length > 100 ? page.at(-1)!.id : null,
    },
  };
}

export class ReplenishmentService {
  constructor(private readonly prisma: PrismaClient) {}
  async list(companyId: string, warehouseId: string, cursor?: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, companyId, isActive: true },
      select: { id: true },
    });
    if (!warehouse) return null;
    return replenishmentRows(this.prisma, companyId, warehouseId, undefined, cursor);
  }
}
