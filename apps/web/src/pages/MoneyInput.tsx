import { parseMoney } from "@felt/shared";
import { useEffect, useState } from "react";

type Props = {
  value: number;
  onChange: (cents: number) => void;
  id?: string;
  min?: number;
  max?: number;
  autoFocus?: boolean;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
};

function centsToText(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function MoneyInput(props: Props) {
  const [text, setText] = useState(centsToText(props.value));

  useEffect(() => {
    const parsed = parseMoney(text);
    if (parsed !== props.value) setText(centsToText(props.value));
  }, [props.value]);

  return (
    <input
      id={props.id}
      autoFocus={props.autoFocus}
      className={props.className}
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const c = parseMoney(next);
        if (c !== null) props.onChange(c);
      }}
      onBlur={() => setText(centsToText(props.value))}
      onKeyDown={props.onKeyDown}
    />
  );
}
