import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  DEV_USER_COOKIE,
  devIdentityEnabled,
} from "@/server/auth/dev-identity";
import { developmentIdentityChoices } from "@/server/auth/dev-identity-choices";

export const dynamic = "force-dynamic";

export default async function DevelopmentIdentityPage() {
  if (!devIdentityEnabled(process.env)) {
    notFound();
  }

  const selected = (await cookies()).get(DEV_USER_COOKIE)?.value;
  const choices = developmentIdentityChoices();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-zinc-500">SupportPilot</p>
        <h1 className="text-4xl font-semibold tracking-tight">
          Development identity
        </h1>
        <p className="max-w-xl text-lg text-zinc-600 dark:text-zinc-400">
          This switch is not authentication. It selects a seeded local user so
          permission checks can run before a GitHub login exists. Production
          rejects the cookie, header, and query parameter.
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {choices.map((choice) => {
          const inUse = choice.id === selected;
          return (
            <li
              key={choice.id}
              className="flex flex-col gap-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-1">
                <p className="font-medium">
                  {choice.displayName}
                  {inUse ? (
                    <span className="ml-2 text-sm font-normal text-zinc-500">
                      In use
                    </span>
                  ) : null}
                </p>
                <p className="font-mono text-sm text-zinc-500">
                  {choice.email}
                </p>
                <ul className="text-sm text-zinc-600 dark:text-zinc-400">
                  {choice.memberships.map((membership) => (
                    <li key={`${choice.id}-${membership.tenantName}`}>
                      {membership.tenantName}: {membership.roles.join(", ")}
                    </li>
                  ))}
                </ul>
              </div>
              <form action="/api/dev-identity" method="post">
                <input type="hidden" name="userId" value={choice.id} />
                <button
                  className="inline-flex h-10 items-center rounded-full border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700"
                  type="submit"
                >
                  Use {choice.displayName}
                </button>
              </form>
            </li>
          );
        })}
      </ul>
      <form action="/api/dev-identity" method="post">
        <input type="hidden" name="intent" value="clear" />
        <button
          className="inline-flex h-10 items-center rounded-full bg-foreground px-4 text-sm font-medium text-background"
          type="submit"
        >
          Clear development identity
        </button>
      </form>
      <div className="flex gap-4">
        <Link
          className="text-sm text-zinc-600 underline dark:text-zinc-400"
          href="/"
        >
          Customer chat
        </Link>
        <Link
          className="text-sm text-zinc-600 underline dark:text-zinc-400"
          href="/staff"
        >
          Staff
        </Link>
      </div>
    </main>
  );
}
