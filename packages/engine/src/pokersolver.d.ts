declare module "pokersolver" {
  export class Hand {
    cards: unknown[];
    rank: number;
    name: string;
    descr: string;
    cardPool: unknown[];

    static solve(cards: string[]): Hand;
    static winners(hands: Hand[]): Hand[];
  }
  const _default: { Hand: typeof Hand };
  export default _default;
}
