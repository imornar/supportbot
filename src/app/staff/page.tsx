"use client";

import Link from "next/link";

import { buttonClass, staffNav, withTenant } from "@/staff-ui/access";
import { StaffNotice, useStaff } from "@/staff-ui/session";

export default function StaffHomePage() {
  const staff = useStaff();
  if (staff.phase !== "ready" || !staff.tenant) {
    return <StaffNotice />;
  }
  const links = staffNav(staff.tenant);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-medium">{staff.tenant.name}</h2>
      {links.length === 0 ? <p>This account has no staff tasks.</p> : null}
      <div className="flex flex-wrap gap-2">
        {links.map((link) => (
          <Link
            key={link.href}
            className={buttonClass}
            href={withTenant(link.href, staff.tenant?.id ?? null)}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
