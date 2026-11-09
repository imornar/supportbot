import Link from "next/link";

import { CustomerChat } from "@/customer-ui/chat-panel";
import { devIdentityEnabled } from "@/server/auth/dev-identity";
import { loadCustomerViewer } from "@/server/customer-ui/viewer";
import { getPublicEnv } from "@/server/env";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { appUrl } = getPublicEnv();
  const viewer = await loadCustomerViewer();

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-zinc-500">SupportPilot</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Customer support
          </h1>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label="Account">
          <a
            className="inline-flex h-10 items-center rounded-full border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700"
            href="/api/health"
          >
            Health
          </a>
          <a
            className="inline-flex h-10 items-center rounded-full border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700"
            href="/api/ready"
          >
            Readiness
          </a>
          {/* Auth.js starts OAuth with a redirect. A client-side Link prefetch is the wrong request. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            className="inline-flex h-10 items-center rounded-full border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700"
            href="/api/auth/signin/github"
          >
            Sign in
          </a>
          {devIdentityEnabled(process.env) ? (
            <Link
              className="inline-flex h-10 items-center rounded-full border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700"
              href="/dev/identity"
            >
              Development identity
            </Link>
          ) : null}
        </nav>
      </header>
      <CustomerChat viewer={viewer} />
      <footer className="text-sm text-zinc-500">
        Public app URL: <span className="font-mono">{appUrl}</span>
      </footer>
    </main>
  );
}
