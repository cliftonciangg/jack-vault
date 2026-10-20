import { GameError } from "../engine/engine.js";
import type { Player, Tx, TxType } from "../store/store.js";

/**
 * Wallet rules as pure functions over a working copy of the player. The game
 * service stages transactions here and commits them with the round in one
 * commit, so a balance never moves without its round record and vice versa.
 */
export class WalletTxBuilder {
  readonly txs: Tx[] = [];
  readonly player: Player;

  constructor(
    player: Player,
    private readonly existing: (txId: string) => Tx | undefined,
    private readonly at: string,
  ) {
    this.player = { ...player };
  }

  /**
   * Stages a transaction. If a transaction with this id was already committed,
   * it is not applied again (retry-safe) and the original is returned.
   */
  apply(txId: string, type: TxType, amountCents: number, roundId: string | null): Tx {
    if (!Number.isInteger(amountCents)) throw new GameError("BAD_AMOUNT", "Amounts are integer cents");
    const prior = this.existing(txId) ?? this.txs.find((t) => t.txId === txId);
    if (prior) {
      if (prior.amountCents !== amountCents || prior.type !== type || prior.playerId !== this.player.id) {
        throw new GameError("TX_CONFLICT", `Transaction ${txId} already exists with different details`, 409);
      }
      return prior;
    }
    const after = this.player.balanceCents + amountCents;
    if (after < 0) throw new GameError("INSUFFICIENT_FUNDS", "Not enough balance for this bet", 402);
    this.player.balanceCents = after;
    const tx: Tx = { txId, playerId: this.player.id, type, amountCents, balanceAfterCents: after, roundId, at: this.at };
    this.txs.push(tx);
    return tx;
  }
}
