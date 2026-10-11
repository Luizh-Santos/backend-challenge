
import {
  Allow,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateTransactionDto {
  @IsString()
  @IsNotEmpty()
  providerId!: string;

  @IsString()
  @IsNotEmpty()
  externalTransactionId!: string;

  @IsString()
  @IsNotEmpty()
  walletId!: string;

  @IsString()
  @IsNotEmpty()
  playerId!: string;

  @IsString()
  @IsNotEmpty()
  roundId!: string;

  @IsString()
  @IsNotEmpty()
  gameId!: string;

  @Allow()
  kind?: string;

  @Allow()
  money?: { amount?: string; currency?: string };

  @Allow()
  referenceTransactionId?: string;

  @Transform(({ obj }) => obj.kind ?? obj.type)
  @IsIn(['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'])
  type!: 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK';

  @Transform(({ obj }) => obj.money?.amount ?? obj.amount)
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,15})\.\d{2}$/)
  amount!: string;

  @Transform(({ obj }) => obj.money?.currency ?? obj.currency)
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @Transform(({ obj }) => obj.referenceTransactionId ?? obj.externalReferenceTransactionId)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  externalReferenceTransactionId?: string;
}
