import type { Role } from "@/server/auth/permissions";

export type SeedUser = {
  id: string;
  email: string;
  displayName: string;
};

export type SeedMembership = {
  id: string;
  tenantId: string;
  userId: string;
  roles: readonly Role[];
};

export const seedTenants = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "harbor",
    name: "Harbor Goods",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    slug: "northwind",
    name: "Northwind Outfitters",
  },
] as const;

export const seedUsers = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    email: "ada@harbor.example",
    displayName: "Ada Harbor",
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    email: "ken@harbor.example",
    displayName: "Ken Harbor",
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    email: "sam@harbor.example",
    displayName: "Sam Harbor",
  },
  {
    id: "10000000-0000-4000-8000-000000000004",
    email: "casey@harbor.example",
    displayName: "Casey Harbor",
  },
  {
    id: "10000000-0000-4000-8000-000000000005",
    email: "nora@northwind.example",
    displayName: "Nora Northwind",
  },
  {
    id: "10000000-0000-4000-8000-000000000006",
    email: "pat@northwind.example",
    displayName: "Pat Northwind",
  },
  {
    id: "10000000-0000-4000-8000-000000000007",
    email: "jordan@example.dev",
    displayName: "Jordan Example",
  },
] as const satisfies readonly SeedUser[];

const harbor = seedTenants[0].id;
const northwind = seedTenants[1].id;

export const seedMemberships: readonly SeedMembership[] = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    tenantId: harbor,
    userId: seedUsers[0].id,
    roles: ["tenant_admin"],
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    tenantId: harbor,
    userId: seedUsers[1].id,
    roles: ["knowledge_manager"],
  },
  {
    id: "30000000-0000-4000-8000-000000000003",
    tenantId: harbor,
    userId: seedUsers[2].id,
    roles: ["support_agent"],
  },
  {
    id: "30000000-0000-4000-8000-000000000004",
    tenantId: harbor,
    userId: seedUsers[3].id,
    roles: ["customer"],
  },
  {
    id: "30000000-0000-4000-8000-000000000005",
    tenantId: northwind,
    userId: seedUsers[4].id,
    roles: ["tenant_admin"],
  },
  {
    id: "30000000-0000-4000-8000-000000000006",
    tenantId: northwind,
    userId: seedUsers[5].id,
    roles: ["customer"],
  },
  {
    id: "30000000-0000-4000-8000-000000000007",
    tenantId: harbor,
    userId: seedUsers[6].id,
    roles: ["customer"],
  },
  {
    id: "30000000-0000-4000-8000-000000000008",
    tenantId: northwind,
    userId: seedUsers[6].id,
    roles: ["support_agent"],
  },
];

export const seedRoleAssignments = [
  {
    id: "40000000-0000-4000-8000-000000000001",
    tenantId: harbor,
    membershipId: seedMemberships[0].id,
    role: "tenant_admin",
  },
  {
    id: "40000000-0000-4000-8000-000000000002",
    tenantId: harbor,
    membershipId: seedMemberships[1].id,
    role: "knowledge_manager",
  },
  {
    id: "40000000-0000-4000-8000-000000000003",
    tenantId: harbor,
    membershipId: seedMemberships[2].id,
    role: "support_agent",
  },
  {
    id: "40000000-0000-4000-8000-000000000004",
    tenantId: harbor,
    membershipId: seedMemberships[3].id,
    role: "customer",
  },
  {
    id: "40000000-0000-4000-8000-000000000005",
    tenantId: northwind,
    membershipId: seedMemberships[4].id,
    role: "tenant_admin",
  },
  {
    id: "40000000-0000-4000-8000-000000000006",
    tenantId: northwind,
    membershipId: seedMemberships[5].id,
    role: "customer",
  },
  {
    id: "40000000-0000-4000-8000-000000000007",
    tenantId: harbor,
    membershipId: seedMemberships[6].id,
    role: "customer",
  },
  {
    id: "40000000-0000-4000-8000-000000000008",
    tenantId: northwind,
    membershipId: seedMemberships[7].id,
    role: "support_agent",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  tenantId: string;
  membershipId: string;
  role: Role;
}>;
