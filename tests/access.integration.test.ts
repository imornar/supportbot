import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { requirePermission } from "@/server/auth/access";
import { loadMembershipAccess } from "@/server/auth/membership-access";
import {
  findUserBySubject,
  linkGitHubSignIn,
  linkVerifiedProviderUser,
} from "@/server/auth/provider-link";
import { closePool, getDb } from "@/server/db/client";
import {
  roleAssignments,
  tenantMemberships,
  tenants,
  users,
} from "@/server/db/schema";
import type { TenantQueryClient } from "@/server/db/tenant-queries";

const databaseUrl = process.env.DATABASE_URL?.trim();
const rollback = new Error("rollback test transaction");

describe.skipIf(!databaseUrl)("permission checks against postgres", () => {
  afterAll(async () => {
    await closePool();
  });

  it("links a verified email once and checks the membership tenant", async () => {
    await withRollback(async (tx) => {
      const tenantA = randomUUID();
      const tenantB = randomUUID();
      const userId = randomUUID();
      const email = `link-${randomUUID().slice(0, 8)}@example.test`;
      const subject = `gh-${randomUUID().slice(0, 8)}`;

      await tx.insert(tenants).values([
        { id: tenantA, slug: slug("a"), name: "Tenant A" },
        { id: tenantB, slug: slug("b"), name: "Tenant B" },
      ]);
      await tx.insert(users).values({
        id: userId,
        email,
        displayName: "Linked user",
      });
      const membershipA = randomUUID();
      const membershipB = randomUUID();
      await tx.insert(tenantMemberships).values([
        { id: membershipA, tenantId: tenantA, userId },
        { id: membershipB, tenantId: tenantB, userId },
      ]);
      await tx.insert(roleAssignments).values([
        {
          tenantId: tenantA,
          membershipId: membershipA,
          role: "customer",
        },
        {
          tenantId: tenantB,
          membershipId: membershipB,
          role: "support_agent",
        },
      ]);

      expect(
        await linkVerifiedProviderUser(tx, {
          provider: "github",
          subject,
          email: email.toUpperCase(),
        }),
      ).toBe(true);
      expect(await findUserBySubject(tx, "github", subject)).toEqual({
        userId,
      });
      expect(
        await linkVerifiedProviderUser(tx, {
          provider: "github",
          subject: `${subject}-other`,
          email,
        }),
      ).toBe(false);

      const stored = await tx
        .select({
          authProvider: users.authProvider,
          authSubject: users.authSubject,
        })
        .from(users)
        .where(eq(users.id, userId));
      expect(stored).toEqual([
        { authProvider: "github", authSubject: subject },
      ]);

      const harborAccess = await loadMembershipAccess(tx, userId, tenantA);
      const otherAccess = await loadMembershipAccess(tx, userId, tenantB);
      expect(harborAccess).toEqual({ roles: ["customer"] });
      expect(otherAccess).toEqual({ roles: ["support_agent"] });

      const deps = {
        env: {
          NODE_ENV: "test",
          SUPPORTPILOT_ALLOW_DEV_IDENTITY: "false",
        },
        readSession: async () => ({ provider: "github", subject }),
        findUserBySubject: (provider: string, providerSubject: string) =>
          findUserBySubject(tx, provider, providerSubject),
        findMembership: (actorId: string, tenantId: string) =>
          loadMembershipAccess(tx, actorId, tenantId),
      };
      const request = new Request("http://localhost:3000/api/access");
      await expect(
        requirePermission(request, "order:read", { tenantId: tenantA }, deps),
      ).resolves.toMatchObject({ userId, tenantId: tenantA });
      await expect(
        requirePermission(request, "order:read", { tenantId: tenantB }, deps),
      ).rejects.toThrow(/Permission denied/);
    });
  });

  it("does not link an unverified GitHub email", async () => {
    await withRollback(async (tx) => {
      const userId = randomUUID();
      const email = `unverified-${randomUUID().slice(0, 8)}@example.test`;
      await tx.insert(users).values({
        id: userId,
        email,
        displayName: "Unverified",
      });
      const linked = await linkGitHubSignIn(tx, {
        subject: "unverified-subject",
        accessToken: "ghp-planted-access-token",
        fetchImpl: async () =>
          Response.json([{ email, primary: true, verified: false }]),
      });
      expect(linked).toBe(false);
      const stored = await tx
        .select({ authSubject: users.authSubject })
        .from(users)
        .where(eq(users.id, userId));
      expect(stored).toEqual([{ authSubject: null }]);
    });
  });
});

async function withRollback(
  run: (tx: TenantQueryClient) => Promise<void>,
): Promise<void> {
  try {
    await getDb().transaction(async (tx) => {
      await run(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) {
      throw error;
    }
  }
}

function slug(label: string): string {
  return `auth-${label}-${randomUUID().slice(0, 8)}`;
}
