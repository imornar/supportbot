import "server-only";

import { seedMemberships, seedTenants, seedUsers } from "@/server/db/seed-data";

export type DevelopmentIdentityChoice = {
  id: string;
  displayName: string;
  email: string;
  memberships: {
    tenantName: string;
    roles: readonly string[];
  }[];
};

export function developmentIdentityChoices(): DevelopmentIdentityChoice[] {
  return seedUsers.map((user) => ({
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    memberships: seedMemberships
      .filter((membership) => membership.userId === user.id)
      .map((membership) => ({
        tenantName:
          seedTenants.find((tenant) => tenant.id === membership.tenantId)
            ?.name ?? "Unknown tenant",
        roles: membership.roles,
      })),
  }));
}
