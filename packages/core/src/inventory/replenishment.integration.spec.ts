import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { ReplenishmentService } from "./replenishment.service.js";
import { PurchaseRequestService } from "../purchasing/purchase-request.service.js";
import { PrismaAuditLogger } from "../audit/audit-logger.js";

(process.env.DATABASE_URL ? describe : describe.skip)("Replenishment — real PostgreSQL", () => {
  const db = new PrismaClient();
  const companyId = newId();
  const actor = { id: "buyer", companyId };
  const service = new ReplenishmentService(db);
  const requests = new PurchaseRequestService(db, new PrismaAuditLogger(db));
  const warehouseId = newId();
  const itemId = newId();
  const zeroItem = newId();
  beforeAll(async () => {
    await db.company.create({
      data: { id: companyId, name: "Replenishment QA", defaultCurrency: "SAR" },
    });
    const year = new Date().getUTCFullYear();
    await db.fiscalYear.create({
      data: {
        id: newId(),
        companyId,
        name: `FY${year}`,
        startDate: new Date(Date.UTC(year, 0, 1)),
        endDate: new Date(Date.UTC(year, 11, 31)),
      },
    });
    await db.warehouse.create({
      data: { id: warehouseId, ref: "WH-1", companyId, code: "MAIN", name: "Main" },
    });
    await db.item.createMany({
      data: [
        {
          id: itemId,
          ref: "IT-1",
          companyId,
          code: "A",
          name: "A",
          unit: "EA",
          reorderPoint: "20.0001",
        },
        {
          id: zeroItem,
          ref: "IT-2",
          companyId,
          code: "B",
          name: "B",
          unit: "EA",
          reorderPoint: "5",
        },
      ],
    });
    await db.itemWarehouseStock.create({
      data: { id: newId(), companyId, warehouseId, itemId, quantity: "3", value: "0" },
    });
  });
  afterAll(() => db.$disconnect());
  it("includes items with no stock row and rejects foreign warehouses", async () => {
    expect(
      (await service.list(companyId, warehouseId))!.data.find((r) => r.itemId === zeroItem),
    ).toMatchObject({ onHand: "0.0000", suggested: "5.0000" });
    expect(await service.list(newId(), warehouseId)).toBeNull();
  });
  it("subtracts pending requests and only the unreceived portion of open orders", async () => {
    await requests.create({ warehouseId, lines: [{ itemId, quantity: "2" }] }, actor, newId());
    const supplierId = newId();
    await db.party.create({
      data: { id: supplierId, ref: "P-1", companyId, name: "Supplier", kind: "COMPANY" },
    });
    await db.purchaseOrder.create({
      data: {
        id: newId(),
        companyId,
        number: "PO-QA",
        supplierId,
        warehouseId,
        status: "PARTIALLY_RECEIVED",
        orderDate: new Date(),
        currency: "SAR",
        totalAmount: "0",
        requestedBy: actor.id,
        correlationId: newId(),
        lines: {
          create: {
            id: newId(),
            itemId,
            quantity: "6",
            receivedQuantity: "2",
            unitPrice: "0",
            lineNumber: 1,
          },
        },
      },
    });
    expect(
      (await service.list(companyId, warehouseId))!.data.find((r) => r.itemId === itemId),
    ).toMatchObject({ requested: "2.0000", incoming: "4.0000", suggested: "11.0001" });
  });
  it("prevents double replenishment and replays the same submission safely", async () => {
    const input = { warehouseId, lines: [{ itemId: zeroItem, quantity: "5" }] };
    const key = newId();
    const outcomes = await Promise.allSettled([
      requests.create(input, actor, newId(), key, true),
      requests.create(input, actor, newId(), newId(), true),
    ]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const winner = outcomes.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{
      id: string;
      status: string;
    }>;
    expect(winner.value.status).toBe("PENDING");
    expect(
      (await service.list(companyId, warehouseId))!.data.find((r) => r.itemId === zeroItem)!
        .suggested,
    ).toBe("0.0000");
    const stored = await db.purchaseRequest.findUniqueOrThrow({ where: { id: winner.value.id } });
    expect((await requests.create(input, actor, newId(), stored.submissionKey!, true)).id).toBe(
      winner.value.id,
    );
    expect(await db.stockMovement.count({ where: { companyId } })).toBe(0);
    await expect(
      requests.create(
        { warehouseId, lines: [{ itemId, quantity: "999" }] },
        actor,
        newId(),
        newId(),
        true,
      ),
    ).rejects.toMatchObject({ code: "STALE_REPLENISHMENT" });
  });
});
