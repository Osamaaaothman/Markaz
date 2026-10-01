// Pure tree logic for the Chart of Accounts screen — deliberately free of runtime imports
// (React, PrimeReact) so it can be unit-tested with plain `node --test`.

export interface AccountLike {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly type: string;
  readonly isPostable: boolean;
  readonly parentId: string | null;
  // #RRGGBB chosen for a top-level account; its whole branch is drawn in it.
  readonly color?: string | null;
}

// PrimeReact's TreeTable does not hand a row's depth to a column template, so depth and the
// original child count are attached once, when the tree is built.
export type AccountNodeData<A extends AccountLike = AccountLike> = A & {
  readonly depth: number;
  readonly childCount: number;
  // The colour of the top-level account this row hangs under (its own colour for a root), or
  // null when that root has none — rows then fall back to the account-type colour.
  readonly branchColor: string | null;
};

export interface AccountTreeNode<A extends AccountLike = AccountLike> {
  readonly key: string;
  readonly data: AccountNodeData<A>;
  readonly children: AccountTreeNode<A>[];
  // PrimeReact applies a node's `style` to its <tr>; this carries the branch colour as a CSS
  // variable so the stylesheet can draw the accent without knowing the colour.
  readonly style?: Readonly<Record<string, string>>;
}

export type ExpandedKeys = Record<string, boolean>;
export type LevelChoice = 1 | 2 | 3 | 4 | "all";

// Links by parentId (the API's code-sorted order is kept among siblings). An account whose
// parent is not in the list — for example because the parent was deactivated — becomes a
// root instead of vanishing.
export function buildAccountTree<A extends AccountLike>(accounts: readonly A[]): AccountTreeNode<A>[] {
  const byId = new Map<string, { account: A; children: string[] }>();
  for (const account of accounts) byId.set(account.id, { account, children: [] });

  const rootIds: string[] = [];
  for (const account of accounts) {
    const parent = account.parentId ? byId.get(account.parentId) : undefined;
    if (parent) parent.children.push(account.id);
    else rootIds.push(account.id);
  }

  const build = (id: string, depth: number, inheritedColor: string | null): AccountTreeNode<A> => {
    const entry = byId.get(id)!;
    const branchColor = depth === 0 ? (entry.account.color ?? null) : inheritedColor;
    return {
      key: id,
      data: { ...entry.account, depth, childCount: entry.children.length, branchColor },
      children: entry.children.map((childId) => build(childId, depth + 1, branchColor)),
      ...(branchColor ? { style: { "--coa-branch-color": branchColor } } : {}),
    };
  };
  return rootIds.map((id) => build(id, 0, null));
}

// Opens a closed row and closes an open one. PrimeReact's TreeTable treats a row as expanded
// when its key is PRESENT in `expandedKeys` (`expandedKeys[key] !== undefined`), not when the
// value is truthy — so closing must delete the key. Storing `false` leaves the row open while
// any chevron computed from the value shows it closed.
export function toggleExpandedKey(keys: ExpandedKeys, key: string): ExpandedKeys {
  if (keys[key] !== undefined) {
    return Object.fromEntries(Object.entries(keys).filter(([openKey]) => openKey !== key));
  }
  return { ...keys, [key]: true };
}

// Every node that has children, down to `level` (1 = roots only, 2 = roots opened, ...).
export function expandedKeysForLevel<A extends AccountLike>(
  tree: readonly AccountTreeNode<A>[],
  level: LevelChoice,
): ExpandedKeys {
  const keys: ExpandedKeys = {};
  const visit = (nodes: readonly AccountTreeNode<A>[]): void => {
    for (const node of nodes) {
      if (node.children.length === 0) continue;
      if (level === "all" || node.data.depth <= level - 2) keys[node.key] = true;
      visit(node.children);
    }
  };
  visit(tree);
  return keys;
}

function matches(account: AccountLike, needle: string): boolean {
  return (
    account.code.toLowerCase().includes(needle) ||
    account.name.toLowerCase().includes(needle) ||
    (account.nameAr ?? "").toLowerCase().includes(needle)
  );
}

export interface FilteredAccountTree<A extends AccountLike = AccountLike> {
  readonly tree: AccountTreeNode<A>[];
  readonly expandedKeys: ExpandedKeys;
}

// Search by code, English name or Arabic name. A matching node stays visible together with
// every ancestor (opened, so the hit is on screen). A match with no matching descendant keeps
// its whole subtree but stays collapsed; a match that also has matching descendants shows
// only those. An empty query returns the tree untouched with nothing forced open.
export function filterAccountTree<A extends AccountLike>(
  tree: readonly AccountTreeNode<A>[],
  query: string,
): FilteredAccountTree<A> {
  const needle = query.trim().toLowerCase();
  if (needle === "") return { tree: [...tree], expandedKeys: {} };

  const expandedKeys: ExpandedKeys = {};
  const filterNode = (node: AccountTreeNode<A>): AccountTreeNode<A> | null => {
    const keptChildren = node.children
      .map(filterNode)
      .filter((child): child is AccountTreeNode<A> => child !== null);
    const selfMatch = matches(node.data, needle);

    if (keptChildren.length > 0) {
      expandedKeys[node.key] = true;
      return { ...node, children: keptChildren };
    }
    return selfMatch ? node : null;
  };

  const filtered = tree.map(filterNode).filter((node): node is AccountTreeNode<A> => node !== null);
  return { tree: filtered, expandedKeys };
}
