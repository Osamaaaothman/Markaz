const KIND_ICONS: Record<string, string> = {
  SUPPLIER: "pi pi-truck",
  CUSTOMER: "pi pi-shopping-bag",
  COMPANY: "pi pi-building",
  PERSON: "pi pi-user",
  EMPLOYEE: "pi pi-id-card",
  OTHER: "pi pi-tag",
};

export function partyKindIcon(kind: string): string {
  return KIND_ICONS[kind] ?? "pi pi-tag";
}
