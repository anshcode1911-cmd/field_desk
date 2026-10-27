import { Module } from '@nestjs/common';
import { SettlementService } from './settlement.service.js';
import { AccountsRepositoryModule } from '../accounts/accounts.repository.js';
import { CreditsRepositoryModule } from '../credits/credits.repository.js';
import { RewardsRepositoryModule } from '../rewards/rewards.repository.js';
@Module({
  imports: [
    AccountsRepositoryModule,
    CreditsRepositoryModule,
    RewardsRepositoryModule,
  ],
  providers: [SettlementService],
  exports: [SettlementService],
})
export class SettlementModule {}
