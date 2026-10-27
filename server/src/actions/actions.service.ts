import { Injectable, ForbiddenException } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import type { User } from '@crm/shared';
import type { ActionEnvelope, ActionResult } from '@crm/shared/crm';
import { BUSINESS_TERMS_VERSION } from '@crm/shared/crm';
import {
  RULEBOOK,
  REACTIONS,
  REACTION_ORDER,
  can,
  type Reaction,
} from '@crm/shared/rulebook';
import {
  REACTION_HANDLERS,
  runHandler,
  type DomainServices,
} from './handlers.js';
import { UsersRepository } from '../users/users.repository.js';
import { ActionsRepository } from '../actions/actions.repository.js';
import { OrdersRepository } from '../orders/orders.repository.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { CustomersService } from '../customers/customers.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { FulfillmentService } from '../fulfillment/fulfillment.service.js';
import { ReturnsService } from '../returns/returns.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { RewardsService } from '../rewards/rewards.service.js';
import { CreditsService } from '../credits/credits.service.js';
import { AuditRepository } from '../audit/audit.repository.js';
import { AuditService } from '../audit/audit.service.js';
import { DatabaseService } from '../database/database.service.js';
import type { ActionContext as Context } from '../common/domain.js';
import {
  useOrder,
  useCustomer,
  fail,
  DomainFailure as Failure,
  DomainDecision as Decision,
} from '../common/domain.js';
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
@Injectable()
export class ActionsService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly actionsRepository: ActionsRepository,
    private readonly ordersRepository: OrdersRepository,
    private readonly customersRepository: CustomersRepository,
    customersService: CustomersService,
    ordersService: OrdersService,
    fulfillmentService: FulfillmentService,
    returnsService: ReturnsService,
    private readonly accountsService: AccountsService,
    rewardsService: RewardsService,
    creditsService: CreditsService,
    private readonly auditRepository: AuditRepository,
    private readonly auditService: AuditService,
    private readonly database: DatabaseService,
  ) {
    this.services = {
      customers: customersService,
      orders: ordersService,
      fulfillment: fulfillmentService,
      returns: returnsService,
      accounts: accountsService,
      rewards: rewardsService,
      credits: creditsService,
    };
  }
  private readonly services: DomainServices;
  execute(envelope: ActionEnvelope, requester: User): ActionResult {
    return this.database.db.transaction(
      () => {
        const actorId = envelope.actorId ?? requester.id;
        if (actorId !== requester.id && requester.role !== 'ADMIN')
          throw new ForbiddenException(
            'You cannot submit actions as another staff member',
          );
        const row = this.usersRepository.findById(actorId);
        if (!row?.active)
          throw new ForbiddenException(
            'The staff account is inactive or missing',
          );
        const actor: User = row;
        const fingerprint = createHash('sha256')
          .update(
            stable({
              command: envelope.command,
              actorId,
              expectedVersion: envelope.expectedVersion,
            }),
          )
          .digest('hex');
        const previous = this.actionsRepository.findRequest(
          requester.id,
          envelope.idempotencyKey,
        );
        if (previous) {
          if (previous.fingerprint === fingerprint)
            return JSON.parse(previous.result) as ActionResult;
          return {
            status: 'CONFLICT',
            actionId: '',
            errors: [
              {
                code: 'IDEMPOTENCY_CONFLICT',
                message:
                  'This request key has already been used for different input',
              },
            ],
            decisions: [],
            effects: [],
            trace: [],
            aggregateVersions: {},
            references: {},
            termsVersion: BUSINESS_TERMS_VERSION,
          };
        }
        const c: Context = {
          id: randomUUID(),
          actor,
          requester,
          now: new Date().toISOString(),
          customerId: '',
          effects: [],
          references: {},
          command: envelope.command,
        };
        const result: ActionResult = {
          status: 'APPLIED',
          actionId: c.id,
          errors: [],
          decisions: [],
          effects: c.effects,
          trace: [],
          aggregateVersions: {},
          references: c.references,
          termsVersion: BUSINESS_TERMS_VERSION,
        };
        try {
          this.database.db.transaction(() => {
            const p = envelope.command.payload;
            const aggregate =
              'orderId' in p
                ? useOrder(c, this.ordersRepository.findById(p.orderId))
                : useCustomer(
                    c,
                    this.customersRepository.findById(p.customerId),
                  );
            if (
              envelope.command.type !== 'PUNCH_ORDER' &&
              envelope.expectedVersion === undefined
            )
              fail(
                'VERSION_REQUIRED',
                'Refresh the record and include its version',
              );
            if (
              envelope.expectedVersion !== undefined &&
              envelope.expectedVersion !== aggregate.version
            )
              fail(
                'VERSION_CONFLICT',
                'The record changed. Refresh and try again.',
              );
            result.trace.push({
              stage: 'request',
              explanation: `${actor.name} (${actor.role}) requested ${envelope.command.type} against version ${aggregate.version}. Business terms ${BUSINESS_TERMS_VERSION}.`,
            });
            const rule = RULEBOOK[envelope.command.type];
            if (!can(actor.role, envelope.command.type))
              fail('FORBIDDEN', 'This operation requires a different role');
            runHandler(this.services, c, envelope.command);
            // The subject is the customer the action is about; an action may
            // also change other customers' books (FDSK-169 moves a payment).
            const affected = [
              ...new Set([c.customerId, ...(c.alsoAffects ?? [])]),
            ];
            const reactions: readonly Reaction[] = rule.then;
            for (const reaction of REACTION_ORDER)
              if (reactions.includes(reaction))
                for (const customerId of REACTIONS[reaction].scope === 'subject'
                  ? [c.customerId]
                  : affected)
                  REACTION_HANDLERS[reaction](this.services, c, customerId);
            const reviews = affected.map((customerId) => {
              this.customersRepository.updateCustomer(c, customerId, {
                version:
                  this.accountsService.summary(customerId).customer.version + 1,
              });
              for (const order of this.ordersRepository.forCustomer(customerId))
                this.ordersRepository.updateOrder(c, order.id, {
                  version: order.version + 1,
                });
              result.aggregateVersions[customerId] =
                this.customersRepository.findById(customerId)!.version;
              for (const order of this.ordersRepository.forCustomer(customerId))
                result.aggregateVersions[order.id] = order.version;
              this.auditRepository.insertEvent(c, {
                id: randomUUID(),
                customer_id: customerId,
                order_id:
                  customerId === c.customerId ? (c.orderId ?? null) : null,
                actor_id: actor.id,
                actor_name: actor.name,
                requested_by: requester.id,
                action_id: c.id,
                type: envelope.command.type,
                payload: JSON.stringify(envelope.command.payload),
                occurred_at: c.now,
              });
              return this.auditService.review(customerId);
            });
            result.review = reviews[0];
            const failedChecks = reviews.flatMap((review) =>
              review.checks.filter((check) => !check.passed),
            );
            if (failedChecks.length)
              fail(
                'ACCOUNT_INCONSISTENT',
                failedChecks
                  .map((check) => `${check.rules.join(', ')}: ${check.label}`)
                  .join('; '),
              );
            this.auditService.enrich(c);
            result.trace.push(
              ...c.effects
                .filter((effect) => effect.reason)
                .map((effect) => ({
                  stage: effect.entity,
                  explanation: effect.reason!,
                })),
            );
            result.trace.push({
              stage: 'completed',
              explanation: `${envelope.command.type} completed by ${actor.name}. ${c.effects.length} records written.`,
            });
          });
        } catch (error) {
          c.effects.length = 0;
          result.aggregateVersions = {};
          result.references = {};
          result.review = undefined;
          result.trace = [];
          if (error instanceof Decision) {
            result.status = 'NEEDS_DECISION';
            result.decisions = error.decisions;
          } else if (error instanceof Failure) {
            result.status = error.code.includes('CONFLICT')
              ? 'CONFLICT'
              : 'REJECTED';
            result.errors = [{ code: error.code, message: error.message }];
          } else throw error;
          result.trace.push({
            stage: 'not_applied',
            explanation: error.message,
          });
        }
        this.actionsRepository.saveRequest({
          id: c.id,
          requester_id: requester.id,
          actor_id: actor.id,
          idempotency_key: envelope.idempotencyKey,
          fingerprint: fingerprint,
          result: JSON.stringify(result),
          created_at: c.now,
        });
        return result;
      },
      { behavior: 'immediate' },
    );
  }
}
