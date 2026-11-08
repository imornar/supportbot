export function developmentSeedAllowed(
  env: Record<string, string | undefined>,
): boolean {
  if (env.NODE_ENV === "production") {
    return false;
  }
  if (env.VERCEL === "1") {
    return false;
  }
  if (env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview") {
    return false;
  }
  return true;
}
