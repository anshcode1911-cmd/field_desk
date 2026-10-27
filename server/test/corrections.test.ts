import 'reflect-metadata';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import type { Role, User } from '@crm/shared';
import type { ActionResult, CrmCommand } from '@crm/shared/crm';
import { DatabaseService } from '../src/database/database.service.js';
import { ActionsService } from '../src/actions/actions.service.js';
import { CustomersService } from '../src/customers/customers.service.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { AccountsService } from '../src/accounts/accounts.service.js';
import { AuditService } from '../src/audit/audit.service.js';
import { UsersRepository } from '../src/users/users.repository.js';
import { UsersService } from '../src/users/users.service.js';
import { configureApp } from '../src/configure-app.js';
import { seedReferenceData } from '../src/scripts/seed-reference-data.js';
import { crmDeliveries } from '../src/fulfillment/fulfillment.model.js';

const directory = mkdtempSync(join(tmpdir(), 'crm-corrections-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = join(directory, 'crm.db');
process.env.JWT_SECRET = 'crm-test-secret-'.repeat(4);
process.env.CLIENT_ORIGIN = 'http://localhost:5173';

/** SKU-A: 10,000 paise per unit, 1,000 points per unit (seed reference data). */
const PRICE = 10000;
const POINTS = 1000;

describe('Data corrections', { concurrency: false }, () => {
  let app: INestApplication,
    actions: ActionsService,
    customers: CustomersService,
    orders: OrdersService,
    accounts: AccountsService,
    audit: AuditService,
    users: UsersRepository,
    database: DatabaseService,
    admin: User;

  before(async () => {
    const { AppModule } = await import('../src/app.module.js');
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    database = app.get(DatabaseService);
    migrate(database.db, { migrationsFolder: resolve('drizzle') });
    actions = app.get(ActionsService);
    customers = app.get(CustomersService);
    orders = app.get(OrdersService);
    accounts = app.get(AccountsService);
    audit = app.get(AuditService);
    users = app.get(UsersRepository);
    admin = await app.get(UsersService).create({
      name: 'Corrections Admin',
      email: 'corrections@example.test',
      password: 'corrections-test-password',
      role: 'ADMIN',
    });
    await app.init();
    seedReferenceData(database, admin);
  });
  after(async () => {
    if (app) await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function run(
    command: CrmCommand,
    role: Role = 'ADMIN',
    expected: ActionResult['status'] = 'APPLIED',
  ) {
    const payload = command.payload;
    const actor =
      role === 'ADMIN'
        ? admin
        : users.listActive().find((user) => user.role === role)!;
    const result = actions.execute(
      {
        command,
        actorId: actor.id,
        idempotencyKey: randomUUID(),
        expectedVersion:
          'orderId' in payload
            ? orders.detail(payload.orderId).order.version
            : accounts.summary(payload.customerId).customer.version,
      },
      admin,
    );
    assert.equal(
      result.status,
      expected,
      `${command.type}: ${JSON.stringify(result.errors)}`,
    );
    return result;
  }
  function customer(name: string) {
    return customers.createCustomer(admin, { name, code: randomUUID() }).id;
  }
  /** An approved, dispatched SKU-A order with the given delivery confirmations. */
  function deliveredOrder(
    customerId: string,
    qty: number,
    deliveries: number[],
  ) {
    const orderId = run(
      {
        type: 'PUNCH_ORDER',
        payload: {
          customerId,
          items: [{ skuId: 'sku-a', qty, unitPricePaise: PRICE }],
        },
      },
      'SALES',
    ).references.orderId!;
    run({ type: 'SUBMIT_ORDER', payload: { orderId } }, 'SALES');
    run({ type: 'APPROVE_ORDER', payload: { orderId, revision: 1 } }, 'KAM');
    const lineKey = orders.detail(orderId).lines[0]!.lineKey;
    const shipmentId = run(
      {
        type: 'START_LOADING',
        payload: { orderId, items: [{ lineKey, qty }] },
      },
      'WAREHOUSE',
    ).references.shipmentId!;
    run(
      { type: 'DISPATCH_SHIPMENT', payload: { orderId, shipmentId } },
      'WAREHOUSE',
    );
    const shipmentLineId = orders.detail(orderId).shipments[0]!.lines[0]!.id;
    for (const delivered of deliveries)
      run(
        {
          type: 'CONFIRM_DELIVERY',
          payload: {
            orderId,
            shipmentId,
            items: [{ shipmentLineId, qty: delivered }],
          },
        },
        'WAREHOUSE',
      );
    return { orderId, shipmentId, shipmentLineId };
  }
  function correctDelivery(
    order: ReturnType<typeof deliveredOrder>,
    deliveredQty: number,
    role: Role = 'KAM',
    expected: ActionResult['status'] = 'APPLIED',
  ) {
    return run(
      {
        type: 'CORRECT_DELIVERY',
        payload: {
          orderId: order.orderId,
          shipmentId: order.shipmentId,
          items: [{ shipmentLineId: order.shipmentLineId, deliveredQty }],
          reason: 'Customer received fewer boxes than confirmed',
          evidence: 'Customer goods receipt note lists six boxes',
        },
      },
      role,
      expected,
    );
  }
  function shipment(order: ReturnType<typeof deliveredOrder>) {
    const row = orders
      .detail(order.orderId)
      .shipments.find((s) => s.id === order.shipmentId)!;
    return { status: row.status, delivered: row.lines[0]!.delivered };
  }
  function assertConsistent(customerId: string) {
    const failed = audit
      .review(customerId)
      .checks.filter((check) => !check.passed);
    assert.deepEqual(failed, []);
  }

  describe('FDSK-170: correct an overstated delivery', () => {
    it('reopens the shipment, frees the overpaid cash, relocks points, and reapplies cash when the rest arrives', () => {
      const customerId = customer('Overstated delivery');
      run(
        {
          type: 'RECEIVE_CUSTOMER_PAYMENT',
          payload: { customerId, amountPaise: 10 * PRICE, reference: 'UTR-1' },
        },
        'ACCOUNTS',
      );
      const order = deliveredOrder(customerId, 10, [10]);
      assert.deepEqual(shipment(order), { status: 'DELIVERED', delivered: 10 });
      assert.equal(accounts.summary(customerId).points.available, 10 * POINTS);

      const result = correctDelivery(order, 6);
      assert.deepEqual(shipment(order), {
        status: 'DISPATCHED',
        delivered: 6,
      });
      let summary = accounts.summary(customerId);
      assert.equal(summary.charges[0]!.remainingPaise, 6 * PRICE);
      assert.equal(summary.outstandingPaise, 0);
      assert.equal(summary.unappliedCashPaise, 4 * PRICE);
      assert.deepEqual(summary.points, {
        locked: 4 * POINTS,
        available: 6 * POINTS,
        redeemed: 0,
        clawbackPending: 0,
      });
      assert.ok(
        result.trace.some((step) =>
          step.explanation.includes('Reverse 4 overstated delivered units'),
        ),
      );
      assertConsistent(customerId);

      run(
        {
          type: 'CONFIRM_DELIVERY',
          payload: {
            orderId: order.orderId,
            shipmentId: order.shipmentId,
            items: [{ shipmentLineId: order.shipmentLineId, qty: 4 }],
          },
        },
        'WAREHOUSE',
      );
      assert.deepEqual(shipment(order), {
        status: 'DELIVERED',
        delivered: 10,
      });
      summary = accounts.summary(customerId);
      assert.equal(summary.unappliedCashPaise, 0);
      assert.equal(summary.outstandingPaise, 0);
      assert.equal(summary.points.available, 10 * POINTS);
      assert.equal(summary.points.locked, 0);
      assertConsistent(customerId);
    });

    it('reverses the newest confirmations first and keeps each linked to its original', () => {
      const customerId = customer('Two confirmations');
      const order = deliveredOrder(customerId, 10, [6, 4]);
      run(
        {
          type: 'RECORD_RETURN',
          payload: {
            orderId: order.orderId,
            items: [{ shipmentLineId: order.shipmentLineId, qty: 2 }],
            feePaise: 0,
            reason: 'Damaged on arrival',
          },
        },
        'WAREHOUSE',
      );
      correctDelivery(order, 3);
      const rows = database.db
        .select()
        .from(crmDeliveries)
        .where(eq(crmDeliveries.shipment_line_id, order.shipmentLineId))
        .all();
      const [first, second] = rows.filter((row) => !row.reversal_of_id);
      const reversals = rows.filter((row) => row.reversal_of_id);
      assert.deepEqual(
        reversals.map((row) => [row.reversal_of_id, row.qty]),
        [
          [second!.id, -4],
          [first!.id, -3],
        ],
      );
      assert.equal(shipment(order).delivered, 3);
      assert.equal(accounts.summary(customerId).outstandingPaise, 1 * PRICE);
      assertConsistent(customerId);
    });

    it('releases cash before credit, back to the original sources', () => {
      const customerId = customer('Cash and credit settlement');
      run(
        {
          type: 'RECEIVE_CUSTOMER_PAYMENT',
          payload: { customerId, amountPaise: 5 * PRICE, reference: 'UTR-A' },
        },
        'ACCOUNTS',
      );
      const creditNoteId = run(
        {
          type: 'ISSUE_CREDIT_NOTE',
          payload: { customerId, amountPaise: 5 * PRICE, reason: 'Goodwill' },
        },
        'ACCOUNTS',
      ).references.creditNoteId!;
      const order = deliveredOrder(customerId, 10, [10]);
      const chargeId = accounts.summary(customerId).charges[0]!.id;
      run(
        {
          type: 'APPLY_CREDIT_NOTE',
          payload: {
            customerId,
            creditNoteId,
            chargeId,
            amountPaise: 5 * PRICE,
          },
        },
        'ACCOUNTS',
      );
      run(
        {
          type: 'RECEIVE_CUSTOMER_PAYMENT',
          payload: { customerId, amountPaise: 5 * PRICE, reference: 'UTR-B' },
        },
        'ACCOUNTS',
      );
      assert.equal(accounts.summary(customerId).outstandingPaise, 0);

      correctDelivery(order, 6);
      let summary = accounts.summary(customerId);
      assert.equal(summary.charges[0]!.cashPaidPaise, 1 * PRICE);
      assert.equal(summary.credits[0]!.availablePaise, 0);
      assert.equal(summary.unappliedCashPaise, 4 * PRICE);

      correctDelivery(order, 2);
      summary = accounts.summary(customerId);
      assert.equal(summary.charges[0]!.remainingPaise, 2 * PRICE);
      assert.equal(summary.charges[0]!.cashPaidPaise, 0);
      assert.equal(summary.credits[0]!.availablePaise, 3 * PRICE);
      assert.equal(summary.unappliedCashPaise, 5 * PRICE);
      assert.equal(summary.points.available, 0);
      assert.equal(summary.points.locked, 10 * POINTS);
      assertConsistent(customerId);
    });

    it('turns spent points into clawback pending when their cash is released', () => {
      const customerId = customer('Spent points');
      run(
        {
          type: 'RECEIVE_CUSTOMER_PAYMENT',
          payload: { customerId, amountPaise: 10 * PRICE, reference: 'UTR-P' },
        },
        'ACCOUNTS',
      );
      const order = deliveredOrder(customerId, 10, [10]);
      deliveredOrder(customerId, 1, [1]);
      const unpaid = accounts
        .summary(customerId)
        .charges.find((charge) => charge.outstandingPaise > 0)!;
      run(
        {
          type: 'REDEEM_POINTS',
          payload: { customerId, chargeId: unpaid.id, points: 8 * POINTS },
        },
        'ACCOUNTS',
      );
      correctDelivery(order, 6);
      const summary = accounts.summary(customerId);
      assert.equal(summary.points.available, 0);
      assert.equal(summary.points.clawbackPending, 2 * POINTS);
      run(
        {
          type: 'REDEEM_POINTS',
          payload: { customerId, chargeId: unpaid.id, points: 1 },
        },
        'ACCOUNTS',
        'REJECTED',
      );
      assertConsistent(customerId);
    });

    it('rejects corrections that are not lower, go below returns, come from the wrong role, or target a loading batch', () => {
      const customerId = customer('Correction guards');
      const order = deliveredOrder(customerId, 10, [10]);
      const code = (result: ActionResult) => result.errors[0]?.code;
      assert.equal(
        code(correctDelivery(order, 10, 'KAM', 'REJECTED')),
        'CORRECTION_NOT_LOWER',
      );
      run(
        {
          type: 'RECORD_RETURN',
          payload: {
            orderId: order.orderId,
            items: [{ shipmentLineId: order.shipmentLineId, qty: 3 }],
            feePaise: 0,
            reason: 'Returned unopened',
          },
        },
        'WAREHOUSE',
      );
      assert.equal(
        code(correctDelivery(order, 2, 'KAM', 'REJECTED')),
        'RETURNED_EXCEEDS_CORRECTION',
      );
      for (const role of ['WAREHOUSE', 'SALES', 'ACCOUNTS'] as const)
        assert.equal(
          code(correctDelivery(order, 6, role, 'REJECTED')),
          'FORBIDDEN',
        );
      const fresh = run(
        {
          type: 'PUNCH_ORDER',
          payload: {
            customerId,
            items: [{ skuId: 'sku-a', qty: 1, unitPricePaise: PRICE }],
          },
        },
        'SALES',
      ).references.orderId!;
      run({ type: 'SUBMIT_ORDER', payload: { orderId: fresh } }, 'SALES');
      run(
        { type: 'APPROVE_ORDER', payload: { orderId: fresh, revision: 1 } },
        'KAM',
      );
      const batch = run(
        {
          type: 'START_LOADING',
          payload: {
            orderId: fresh,
            items: [
              { lineKey: orders.detail(fresh).lines[0]!.lineKey, qty: 1 },
            ],
          },
        },
        'WAREHOUSE',
      ).references.shipmentId!;
      const rejected = run(
        {
          type: 'CORRECT_DELIVERY',
          payload: {
            orderId: fresh,
            shipmentId: batch,
            items: [
              {
                shipmentLineId: orders.detail(fresh).shipments[0]!.lines[0]!.id,
                deliveredQty: 0,
              },
            ],
            reason: 'Nothing was delivered',
            evidence: 'Loading batch never left',
          },
        },
        'KAM',
        'REJECTED',
      );
      assert.equal(code(rejected), 'SHIPMENT_STATE');
      assert.equal(shipment(order).delivered, 10);
      assertConsistent(customerId);
    });
  });
});
