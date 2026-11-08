import "server-only";

import GitHub from "next-auth/providers/github";

/**
 * One OAuth provider. There is no Credentials provider and no password hash.
 * Auth.js reads AUTH_GITHUB_ID and AUTH_GITHUB_SECRET.
 */
export const authProviders = [GitHub];
