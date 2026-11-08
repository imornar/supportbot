import "next-auth";

declare module "next-auth" {
  interface Session {
    authProvider?: string;
    authSubject?: string;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    authProvider?: string;
    authSubject?: string;
  }
}
