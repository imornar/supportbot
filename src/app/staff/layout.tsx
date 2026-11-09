import type { ReactNode } from "react";

import { devIdentityEnabled } from "@/server/auth/dev-identity";
import { StaffShell } from "@/staff-ui/session";

export const dynamic = "force-dynamic";

export default function StaffLayout({ children }: { children: ReactNode }) {
  return (
    <StaffShell devIdentity={devIdentityEnabled(process.env)}>
      {children}
    </StaffShell>
  );
}
