import { Money } from "@erp/shared";
import { groupThousands } from "../lib/money";
import { useCountUp } from "../lib/use-count-up";
import { useRevealed } from "./Reveal";

// A money figure that counts up when it appears (inside a <Reveal>: when its card scrolls into view). The
// tumbling digits are only decoration: the moment the animation ends — and for anyone who prefers reduced
// motion, immediately — it shows the exact decimal string the API sent, never a rounded float (docs/04 §2).
export function AnimatedMoney({ amount, currency, className }: { amount: string; currency: string; className?: string }): React.JSX.Element {
  const revealed = useRevealed();
  const progress = useCountUp(revealed ? amount : null);
  const exact = groupThousands(Money.of(amount, currency).toDecimalString());
  const p = revealed ? progress : 0;
  const shown = p >= 1 ? exact : groupThousands((Number(amount) * p).toFixed(2));
  return (
    <span className={className} dir="ltr">
      <bdi>{shown}</bdi>
      <small>{currency}</small>
    </span>
  );
}
