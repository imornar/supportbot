"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  buttonClass,
  staffNav,
  withTenant,
  type StaffTenant,
} from "@/staff-ui/access";
import { loadStaffSession } from "@/staff-ui/api";

export type StaffPhase =
  "loading" | "anonymous" | "rejected" | "error" | "ready";

type StaffContextValue = {
  phase: StaffPhase;
  tenants: StaffTenant[];
  tenant: StaffTenant | null;
  devIdentity: boolean;
  chooseTenant: (tenantId: string) => void;
};

const StaffContext = createContext<StaffContextValue | null>(null);

export function useStaff(): StaffContextValue {
  const value = useContext(StaffContext);
  if (!value) {
    throw new Error("Staff screens render inside the staff shell.");
  }
  return value;
}

export function StaffShell({
  children,
  devIdentity,
}: {
  children: ReactNode;
  devIdentity: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [phase, setPhase] = useState<StaffPhase>("loading");
  const [tenants, setTenants] = useState<StaffTenant[]>([]);
  const [overrideId, setOverrideId] = useState<string | null>(null);
  const tenant =
    tenants.find((item) => item.id === overrideId) ?? tenants[0] ?? null;

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get(
      "tenantId",
    );
    let cancelled = false;
    void loadStaffSession()
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (requested) {
          setOverrideId(requested);
        }
        if (!result.ok) {
          setTenants([]);
          if (result.message === "Sign in to continue.") {
            setPhase("anonymous");
            return;
          }
          if (
            result.message === "You do not have permission for that action."
          ) {
            setPhase("rejected");
            return;
          }
          setPhase("error");
          return;
        }
        setTenants(result.body.tenants);
        setPhase("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setPhase("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function chooseTenant(tenantId: string) {
    setOverrideId(tenantId);
    const next = new URLSearchParams(window.location.search);
    next.set("tenantId", tenantId);
    router.push(`${pathname}?${next.toString()}`);
  }

  const links = staffNav(tenant);

  return (
    <StaffContext.Provider
      value={{ phase, tenants, tenant, devIdentity, chooseTenant }}
    >
      <main className="mx-auto flex min-h-full w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
        <header className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-zinc-500">SupportPilot</p>
              <h1 className="text-3xl font-semibold tracking-tight">Staff</h1>
            </div>
            <nav className="flex flex-wrap gap-2" aria-label="Account">
              <Link className={buttonClass} href="/">
                Customer chat
              </Link>
              {devIdentity ? (
                <Link className={buttonClass} href="/dev/identity">
                  Development identity
                </Link>
              ) : null}
            </nav>
          </div>
          <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            These links follow your permissions. Each action is checked again on
            the server.
          </p>
          {tenant ? (
            <label className="flex max-w-sm flex-col gap-1 text-sm font-medium">
              Tenant
              <select
                className="h-10 rounded-xl border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
                value={tenant.id}
                onChange={(event) => chooseTenant(event.target.value)}
              >
                {tenants.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <nav className="flex flex-wrap gap-2" aria-label="Staff">
            {links.map((link) => {
              const current =
                pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  className={buttonClass}
                  href={withTenant(link.href, tenant?.id ?? null)}
                  aria-current={current ? "page" : undefined}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </header>
        {children}
      </main>
    </StaffContext.Provider>
  );
}

export function StaffNotice() {
  const staff = useStaff();
  if (staff.phase === "loading") {
    return <p>Loading staff access.</p>;
  }
  if (staff.phase === "anonymous") {
    return <p role="alert">Sign in to use staff tools.</p>;
  }
  if (staff.phase === "rejected") {
    return <p role="alert">This development identity is not accepted.</p>;
  }
  if (staff.phase === "error") {
    return <p role="alert">Staff access could not be loaded.</p>;
  }
  if (!staff.tenant) {
    return <p>This account has no staff tasks.</p>;
  }
  return null;
}
