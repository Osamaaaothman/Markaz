import { SupplierInvoicesPage } from "./SupplierInvoicesPage";

// Purchase returns are created from the original posted supplier invoice.
export function GoodsReturnsPage(): React.JSX.Element {
  return <SupplierInvoicesPage returnsOnly />;
}
