const KIND_ICONS: Record<string, string> = {
  COMPANY: "pi pi-building",
  PERSON: "pi pi-user",
  EMPLOYEE: "pi pi-id-card",
  OTHER: "pi pi-tag",
};

export function partyKindIcon(kind: string): string {
  return KIND_ICONS[kind] ?? "pi pi-tag";
}
