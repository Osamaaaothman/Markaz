import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import * as argon2 from "argon2";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "./auth.service";

const activeUser = {
  id: "user_1",
  email: "admin@markaz.local",
  name: "Admin",
  isActive: true,
  deletedAt: null,
  role: { name: "Admin" },
};

describe("AuthService", () => {
  let authService: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock };
    refreshToken: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let jwt: { signAsync: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      refreshToken: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    jwt = { signAsync: jest.fn().mockResolvedValue("signed.jwt.token") };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();

    authService = moduleRef.get(AuthService);
  });

  describe("login", () => {
    it("throws when no user matches the email", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        authService.login({ email: "nobody@markaz.local", password: "whatever" }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("throws when the user is inactive", async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        isActive: false,
        passwordHash: await argon2.hash("correct-password"),
      });

      await expect(
        authService.login({ email: activeUser.email, password: "correct-password" }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("throws when the password doesn't match", async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        passwordHash: await argon2.hash("correct-password"),
      });

      await expect(
        authService.login({ email: activeUser.email, password: "wrong-password" }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("returns tokens and the user on valid credentials", async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        passwordHash: await argon2.hash("correct-password"),
      });
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await authService.login({
        email: activeUser.email,
        password: "correct-password",
      });

      expect(result.accessToken).toBe("signed.jwt.token");
      expect(result.refreshToken).toEqual(expect.any(String));
      expect(result.user).toEqual({
        id: activeUser.id,
        email: activeUser.email,
        name: activeUser.name,
        role: "Admin",
      });
      expect(jwt.signAsync).toHaveBeenCalledWith({
        sub: activeUser.id,
        email: activeUser.email,
        role: "Admin",
      });
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("refresh", () => {
    it("throws when the token isn't found", async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(authService.refresh("unknown-token")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it("throws when the token is expired", async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: "rt_1",
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
        user: activeUser,
      });

      await expect(authService.refresh("expired-token")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it("throws when the token was already revoked", async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: "rt_1",
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60),
        user: activeUser,
      });

      await expect(authService.refresh("revoked-token")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it("throws when the account is no longer active", async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: "rt_1",
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60),
        user: { ...activeUser, isActive: false },
      });
      prisma.refreshToken.update.mockResolvedValue({});

      await expect(authService.refresh("valid-token")).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("rotates the token and issues a new pair on success", async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: "rt_1",
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60),
        user: activeUser,
      });
      prisma.refreshToken.update.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await authService.refresh("valid-token");

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: "rt_1" },
        data: { revokedAt: expect.any(Date) },
      });
      expect(result.accessToken).toBe("signed.jwt.token");
    });
  });

  describe("logout", () => {
    it("revokes the matching, not-yet-revoked refresh token", async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await authService.logout("some-token");

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { tokenHash: expect.any(String), revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
});
