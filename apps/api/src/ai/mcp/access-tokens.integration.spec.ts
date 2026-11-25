import { PrismaAuditLogger } from "@erp/core";
import { PrismaClient } from "@erp/db";
import { newId } from "@erp/shared";
import { AccessTokenError, AccessTokenService, hashAccessToken } from "./access-tokens.js";

(process.env.DATABASE_URL ? describe : describe.skip)("MCP access tokens — real PostgreSQL", () => {
  const db = new PrismaClient();
  const companyId = newId();
  const owner = { id: newId(), companyId };
  const other = { id: newId(), companyId };
  const tokens = new AccessTokenService(db, new PrismaAuditLogger(db));
  const allow = (): Promise<boolean> => Promise.resolve(true);

  beforeAll(async () => {
    await db.company.create({ data: { id: companyId, name: "Token QA", nameAr: "اختبار الرموز", defaultCurrency: "SAR" } });
    for (const [user, ref] of [[owner, "USR-T1"], [other, "USR-T2"]] as const) {
      await db.user.create({ data: { ...user, ref, email: `${user.id}@example.test`, passwordHash: "unused" } });
    }
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("shows the token once, stores only its hash, and lets it act as its user", async () => {
    const created = await tokens.create(owner, "  Claude Desktop  ", "read", allow);
    expect(created.name).toBe("Claude Desktop");
    expect(created.token.startsWith(created.tokenPrefix)).toBe(true);
    const row = await db.aiAccessToken.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.tokenHash).toBe(hashAccessToken(created.token));
    expect(JSON.stringify(row)).not.toContain(created.token);
    expect(await tokens.verify(created.token)).toEqual({ id: owner.id, companyId, token: { id: created.id, name: "Claude Desktop", scope: "read" } });
    expect((await db.aiAccessToken.findUniqueOrThrow({ where: { id: created.id } })).lastUsedAt).not.toBeNull();
    // The list never carries the token or its hash.
    const listed = await tokens.list(owner);
    expect(JSON.stringify(listed)).not.toContain(created.token);
    expect(JSON.stringify(listed)).not.toContain(row.tokenHash);
  });

  it("refuses a made-up, revoked, or deactivated user's token", async () => {
    expect(await tokens.verify("mkz_mcp_not-a-real-token")).toBeNull();
    expect(await tokens.verify("eyJhbGciOi.jwt.like")).toBeNull();

    const revoked = await tokens.create(owner, "to revoke", "read", allow);
    await tokens.revoke(owner, revoked.id);
    expect(await tokens.verify(revoked.token)).toBeNull();
    await expect(tokens.revoke(owner, revoked.id)).rejects.toThrow(AccessTokenError);

    const ofOther = await tokens.create(other, "other's", "read", allow);
    await db.user.update({ where: { id: other.id }, data: { isActive: false } });
    expect(await tokens.verify(ofOther.token)).toBeNull();
  });

  it("a user cannot see or revoke someone else's token", async () => {
    const mine = await tokens.create(owner, "mine", "read", allow);
    expect((await tokens.list(other)).some((t) => t.id === mine.id)).toBe(false);
    await expect(tokens.revoke(other, mine.id)).rejects.toThrow("TOKEN_NOT_FOUND");
    expect(await tokens.verify(mine.token)).not.toBeNull();
  });

  it("refuses an empty name", async () => {
    await expect(tokens.create(owner, "   ", "read", allow)).rejects.toThrow("NAME_REQUIRED");
  });

  it("needs the matching chat permission for a review or write token", async () => {
    const asked: string[] = [];
    const only = (granted: string) => (_r: string, action: string): Promise<boolean> => { asked.push(action); return Promise.resolve(action === granted); };
    await expect(tokens.create(owner, "w", "write", only("interact"))).rejects.toThrow("FORBIDDEN");
    const review = await tokens.create(owner, "r", "review", only("interact"));
    expect(review.scope).toBe("review");
    expect((await tokens.verify(review.token))?.token.scope).toBe("review");
    expect(asked).toEqual(["auto", "interact"]);
    await expect(tokens.create(owner, "x", "admin", allow)).rejects.toThrow("INVALID_SCOPE");
  });
});
