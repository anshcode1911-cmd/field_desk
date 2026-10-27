import { Module } from '@nestjs/common';
import { CreditsService } from './credits.service.js';
import { CreditsController } from './credits.controller.js';
import { CustomersRepositoryModule } from '../customers/customers.repository.js';
import { AccountsRepositoryModule } from '../accounts/accounts.repository.js';
import { CreditsRepositoryModule } from '../credits/credits.repository.js';
import { SettlementModule } from '../settlement/settlement.module.js';
@Module({
  imports: [
    CustomersRepositoryModule,
    AccountsRepositoryModule,
    CreditsRepositoryModule,
    SettlementModule,
  ],
  controllers: [CreditsController],
  providers: [CreditsService],
  exports: [CreditsService],
})
export class CreditsModule {}
