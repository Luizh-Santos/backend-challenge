export interface MoneyProps {
  amount: string;
  currency: string;
}

export class InvalidMoneyError extends Error {}

/** Exact, immutable decimal money. All arithmetic is performed in minor units. */
export class Money {
  private constructor(private readonly minorUnits: bigint, readonly currency: string) {}

  static from(props: MoneyProps): Money {
    if (!/^[A-Z]{3}$/.test(props.currency)) throw new InvalidMoneyError('Moeda inválida');
    if (!/^(?:0|[1-9]\d{0,15})\.\d{2}$/.test(props.amount)) {
      throw new InvalidMoneyError('Valor monetário inválido');
    }
    const [whole, fraction] = props.amount.split('.');
    return new Money(BigInt(whole!) * 100n + BigInt(fraction!), props.currency);
  }

  static zero(currency: string): Money { return new Money(0n, currency); }
  static fromMinorUnits(minorUnits: bigint, currency: string): Money { return new Money(minorUnits, currency); }
  toMinorUnits(): bigint { return this.minorUnits; }

  add(other: Money): Money { this.assertSameCurrency(other); return Money.fromMinorUnits(this.minorUnits + other.minorUnits, this.currency); }
  subtract(other: Money): Money { this.assertSameCurrency(other); return Money.fromMinorUnits(this.minorUnits - other.minorUnits, this.currency); }
  negate(): Money { return Money.fromMinorUnits(-this.minorUnits, this.currency); }
  isZero(): boolean { return this.minorUnits === 0n; }
  isPositive(): boolean { return this.minorUnits > 0n; }
  isNegative(): boolean { return this.minorUnits < 0n; }
  isLessThan(other: Money): boolean { this.assertSameCurrency(other); return this.minorUnits < other.minorUnits; }
  equals(other: Money): boolean { this.assertSameCurrency(other); return this.minorUnits === other.minorUnits; }
  toString(): string {
    const abs = this.minorUnits < 0n ? -this.minorUnits : this.minorUnits;
    return `${this.minorUnits < 0n ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
  }
  toJSON(): MoneyProps { return { amount: this.toString(), currency: this.currency }; }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) throw new InvalidMoneyError('Moedas diferentes não podem ser operadas');
  }
}
