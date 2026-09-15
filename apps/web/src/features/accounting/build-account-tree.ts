import type { TreeNode } from "primereact/treenode";
import type { ChartOfAccountEntry } from "./use-chart-of-accounts";

// The API returns a flat, code-sorted list (parent rows already sort before
// their children because of the code numbering convention — "1000" before
// "1100" — but this doesn't rely on that, it links by parentId explicitly).
export function buildAccountTree(accounts: readonly ChartOfAccountEntry[]): TreeNode[] {
  const nodesById = new Map<string, TreeNode>();
  for (const account of accounts) {
    nodesById.set(account.id, { key: account.id, data: account, children: [] });
  }

  const roots: TreeNode[] = [];
  for (const account of accounts) {
    const node = nodesById.get(account.id)!;
    const parent = account.parentId ? nodesById.get(account.parentId) : undefined;
    if (parent) {
      parent.children!.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}
