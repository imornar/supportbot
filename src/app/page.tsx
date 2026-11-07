import { getPublicEnv } from "@/server/env";

export default function HomePage() {
  const { appUrl } = getPublicEnv();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-zinc-500">SupportPilot</p>
        <h1 className="text-4xl font-semibold tracking-tight">SupportPilot</h1>
        <p className="max-w-xl text-lg text-zinc-600 dark:text-zinc-400">
          Multi-tenant AI customer support. This foundation serves the app and
          its health checks. Documents, auth, and answers come in later steps.
        </p>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Public app URL: <span className="font-mono">{appUrl}</span>
      </p>
      <div className="flex flex-wrap gap-3">
        <a
          className="inline-flex h-10 items-center rounded-full bg-foreground px-4 text-sm font-medium text-background"
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
      </div>
    </main>
  );
}
