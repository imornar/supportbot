export type CustomerTenant = {
  id: string;
  name: string;
};

export type CustomerChatViewer =
  | { kind: "anonymous" }
  | { kind: "signed_in"; tenants: CustomerTenant[] }
  | { kind: "rejected" }
  | { kind: "unavailable" };
