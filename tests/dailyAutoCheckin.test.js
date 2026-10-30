'use strict';

const assert = require('assert');
const {
  claimDailyCheckin,
  claimNotificationDelivery,
  dailyCheckinSourceId,
  runDailyAutoCheckin,
  runDailyAutoCheckinSweep,
  isAutomaticCheckinDue
} = require('../utils/dailyAutoCheckin');

const DAY_MS = 24 * 60 * 60 * 1000;
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const query = value => {
  const promise = Promise.resolve(value);
  promise.session = () => promise;
  promise.select = () => promise;
  promise.lean = () => promise;
  return promise;
};

function equalDate(a, b) {
  if (a == null && b == null) return true;
  return a != null && b != null && new Date(a).getTime() === new Date(b).getTime();
}

function matchesLastCheckIn(user, filter) {
  if (filter.$or) {
    const matchesOr = filter.$or.some(condition => {
      if (condition.lastCheckIn === null) return user.lastCheckIn == null;
      if (condition.lastCheckIn?.$exists === false) return user.lastCheckIn == null;
      if (condition.lastCheckIn?.$lt) return new Date(user.lastCheckIn).getTime() < new Date(condition.lastCheckIn.$lt).getTime();
      return false;
    });
    if (!matchesOr) return false;
  }
  if (Object.prototype.hasOwnProperty.call(filter, 'lastCheckIn') && filter.lastCheckIn !== undefined) {
    if (!equalDate(user.lastCheckIn, filter.lastCheckIn)) return false;
  }
  return true;
}

function createFakeDatabase(initialUsers) {
  const state = {
    users: new Map(initialUsers.map(user => [String(user._id), clone(user)])),
    ledger: new Map(),
    deliveries: new Map()
  };
  let queueTail = Promise.resolve();

  const User = {
    find: () => query([...state.users.values()].map(clone)),
    findById: (id) => query(clone(state.users.get(String(id)))),
    findOneAndUpdate: async (filter, update, { session } = {}) => {
      const working = session?.users || state.users;
      const id = String(filter._id);
      const current = working.get(id);
      if (!current || filter.isBanned !== undefined && current.isBanned !== filter.isBanned || !matchesLastCheckIn(current, filter)) return null;
      const updated = clone(current);
      Object.entries(update.$set || {}).forEach(([key, value]) => { updated[key] = value instanceof Date ? new Date(value) : value; });
      Object.entries(update.$inc || {}).forEach(([key, value]) => { updated[key] = Number(updated[key] || 0) + value; });
      working.set(id, updated);
      return clone(updated);
    }
  };

  const PointsLedger = {
    findOne: ({ sourceId }, session) => query((session?.ledger || state.ledger).get(String(sourceId)) || null)
  };

  const withMongoTransaction = async work => {
    const run = queueTail.then(async () => {
      const draft = {
        users: new Map([...state.users.entries()].map(([id, user]) => [id, clone(user)])),
        ledger: new Map([...state.ledger.entries()].map(([key, row]) => [key, clone(row)])),
        deliveries: new Map([...state.deliveries.entries()].map(([key, row]) => [key, clone(row)]))
      };
      try {
        const result = await work(draft);
        state.users = draft.users;
        state.ledger = draft.ledger;
        state.deliveries = draft.deliveries;
        return result;
      } catch (error) {
        throw error;
      }
    });
    queueTail = run.catch(() => {});
    return run;
  };

  const recordLedger = async ({ sourceId, user, amount, balanceAfter, session }) => {
    if (session.ledger.has(sourceId)) return { created: false, duplicate: true };
    const entry = { sourceId, user, amount, balanceAfter };
    session.ledger.set(sourceId, entry);
    return { created: true, entry };
  };

  const NotificationDelivery = {
    findOneAndUpdate: async (filter, update) => {
      const current = state.deliveries.get(filter.eventKey);
      const ready = current && (!current.nextAttemptAt || new Date(current.nextAttemptAt) <= new Date(filter.$and[0].$or[1].nextAttemptAt.$lte));
      const canClaim = ready && current.attempts < filter.attempts.$lt
        && (current.status === 'pending' || current.status === 'unknown'
          || (current.status === 'sending' && new Date(current.sendingAt) < new Date(filter.$or[2].sendingAt.$lt)));
      if (!canClaim) return null;
      current.status = update.$set.status;
      current.type = update.$set.type;
      current.telegramId = update.$set.telegramId;
      current.sendingAt = update.$set.sendingAt;
      current.error = update.$set.error;
      current.nextAttemptAt = update.$set.nextAttemptAt;
      current.attempts += update.$inc.attempts;
      return clone(current);
    },
    create: async payload => {
      if (state.deliveries.has(payload.eventKey)) {
        const error = new Error('duplicate delivery');
        error.code = 11000;
        throw error;
      }
      const row = { _id: `delivery-${state.deliveries.size + 1}`, ...clone(payload) };
      state.deliveries.set(payload.eventKey, row);
      return clone(row);
    },
    updateOne: async (filter, update) => {
      const row = [...state.deliveries.values()].find(item => String(item._id) === String(filter._id) && item.status === filter.status);
      if (row) Object.assign(row, update.$set || {});
      return { modifiedCount: row ? 1 : 0 };
    }
  };

  const enqueuePendingNotification = async ({ session, ...payload }) => {
    assert.ok(session, 'outbox must use the credit transaction');
    if (!session.deliveries.has(payload.eventKey)) session.deliveries.set(payload.eventKey, {
      _id: `delivery-${session.deliveries.size + 1}`, ...clone(payload),
      status: 'pending', attempts: 0, nextAttemptAt: null
    });
  };
  return { state, User, PointsLedger, withMongoTransaction, recordLedger, NotificationDelivery, enqueuePendingNotification };
}

const at = (dayOffset, hour, minute) => new Date(Date.UTC(2026, 0, 1 + dayOffset, hour, minute));

(async () => {
  assert.strictEqual(isAutomaticCheckinDue(at(0, 2, 29)), false);
  assert.strictEqual(isAutomaticCheckinDue(at(0, 2, 30)), true);

  const db = createFakeDatabase([
    { _id: 'u1', telegramId: '101', language: 'en', points: 0, streak: 0, totalCheckins: 0, lastCheckIn: null, isBanned: false },
    { _id: 'u2', telegramId: '102', language: 'fa', points: 50, streak: 3, totalCheckins: 3, lastCheckIn: null, isBanned: true },
    { _id: 'u3', telegramId: '', language: 'ps', points: 0, streak: 0, totalCheckins: 0, lastCheckIn: null, isBanned: false }
  ]);
  const notifyCalls = [];
  const dependencies = {
    ...db,
    notifyUser: async (telegramId, text) => { notifyCalls.push({ telegramId, text }); return true; },
    notificationType: 'daily_checkin_test'
  };

  const before = await runDailyAutoCheckin(at(0, 2, 29), dependencies);
  assert.strictEqual(before.skipped, 'before_schedule');
  assert.strictEqual(db.state.users.get('u1').points, 0);

  const first = await runDailyAutoCheckin(at(0, 2, 30), dependencies);
  assert.strictEqual(first.credited, 2);
  assert.strictEqual(first.banned, 1);
  assert.strictEqual(first.notificationsSent, 1);
  assert.strictEqual(first.notificationsSkipped, 1);
  assert.strictEqual(db.state.users.get('u1').points, 5);
  assert.strictEqual(db.state.users.get('u3').points, 5);
  assert.strictEqual(db.state.users.get('u2').points, 50);
  assert.strictEqual(db.state.ledger.size, 2);
  assert.match(notifyCalls[0].text, /\+5/);

  const repeat = await runDailyAutoCheckin(at(0, 2, 31), dependencies);
  assert.strictEqual(repeat.credited, 0);
  assert.strictEqual(repeat.alreadyClaimed, 2);
  assert.strictEqual(db.state.ledger.size, 2);

  const nextDay = await runDailyAutoCheckin(at(1, 2, 30), dependencies);
  assert.strictEqual(nextDay.credited, 2);
  assert.strictEqual(db.state.users.get('u1').points, 12);
  assert.strictEqual(db.state.users.get('u1').streak, 2);
  assert.strictEqual(db.state.ledger.has(dailyCheckinSourceId('u1', Math.floor(at(1, 0, 0).getTime() / DAY_MS))), true);

  const collisionDb = createFakeDatabase([
    { _id: 'collision', telegramId: '200', language: 'en', points: 0, streak: 0, totalCheckins: 0, lastCheckIn: null, isBanned: false }
  ]);
  const collisionOptions = { ...collisionDb };
  const collision = await Promise.all([
    claimDailyCheckin('collision', { ...collisionOptions, now: at(2, 2, 30) }),
    claimDailyCheckin('collision', { ...collisionOptions, now: at(2, 2, 30) })
  ]);
  assert.deepStrictEqual(collision.map(item => item.status).sort(), ['already_claimed', 'credited']);
  assert.strictEqual(collisionDb.state.users.get('collision').points, 5);
  assert.strictEqual(collisionDb.state.ledger.size, 1);

  const invalidDb = createFakeDatabase([
    { _id: 'invalid', telegramId: '201', language: 'en', points: 9, streak: 1, totalCheckins: 1, lastCheckIn: at(0, 2, 30), isBanned: false }
  ]);
  await assert.rejects(
    claimDailyCheckin('invalid', { ...invalidDb, now: at(1, 2, 30), rewardForStreak: () => 0 }),
    error => error.code === 'INVALID_CHECKIN_REWARD'
  );
  assert.strictEqual(invalidDb.state.users.get('invalid').points, 9);
  assert.strictEqual(invalidDb.state.ledger.size, 0);

  const rollbackDb = createFakeDatabase([
    { _id: 'rollback', telegramId: '202', language: 'en', points: 9, streak: 1, totalCheckins: 1, lastCheckIn: at(0, 2, 30), isBanned: false }
  ]);
  await assert.rejects(
    claimDailyCheckin('rollback', { ...rollbackDb, now: at(1, 2, 30), recordLedger: async () => { throw new Error('ledger unavailable'); } }),
    /ledger unavailable/
  );
  assert.strictEqual(rollbackDb.state.users.get('rollback').points, 9);
  assert.strictEqual(rollbackDb.state.users.get('rollback').totalCheckins, 1);
  assert.strictEqual(rollbackDb.state.ledger.size, 0);

  const notifyDb = createFakeDatabase([]);
  let notificationAttempt = 0;
  const notificationOptions = {
    NotificationDelivery: notifyDb.NotificationDelivery,
    now: at(3, 3, 0),
    notifyUser: async () => { notificationAttempt += 1; return notificationAttempt > 1; },
    notificationType: 'daily_checkin_test'
  };
  const firstNotification = await claimNotificationDelivery({
    eventKey: 'daily-checkin:checkin:user:3',
    user: { _id: 'notify', telegramId: '300', language: 'en' },
    amount: 11,
    cycleDay: 4,
    streak: 4
  }, notificationOptions);
  assert.strictEqual(firstNotification.status, 'failed');
  const earlyRetry = await claimNotificationDelivery({
    eventKey: 'daily-checkin:checkin:user:3', user: { _id: 'notify', telegramId: '300', language: 'en' },
    amount: 11, cycleDay: 4, streak: 4
  }, notificationOptions);
  assert.strictEqual(earlyRetry.status, 'duplicate');
  assert.strictEqual(notificationAttempt, 1, 'backoff must avoid repeated provider calls');
  const retryNotification = await claimNotificationDelivery({
    eventKey: 'daily-checkin:checkin:user:3',
    user: { _id: 'notify', telegramId: '300', language: 'en' },
    amount: 11,
    cycleDay: 4,
    streak: 4
  }, { ...notificationOptions, now: new Date(at(3, 3, 0).getTime() + 61000) });
  assert.strictEqual(retryNotification.status, 'sent');
  assert.strictEqual(notifyDb.state.deliveries.get('daily-checkin:checkin:user:3').attempts, 2);

  const disabledSweep = await runDailyAutoCheckinSweep(at(4, 2, 30), {
    ...db,
    Settings: { getGlobal: async () => ({ dailyAutoCheckinEnabled: false }) }
  });
  assert.strictEqual(disabledSweep.skipped, 'disabled');

  const manualReceiptDb = createFakeDatabase([
    { _id: 'manual', telegramId: '400', language: 'en', points: 0, streak: 0, totalCheckins: 0, lastCheckIn: null, isBanned: false }
  ]);
  await claimDailyCheckin('manual', { ...manualReceiptDb, now: at(5, 1, 0) });
  let receiptSent = 0;
  const enabledSweep = await runDailyAutoCheckinSweep(at(5, 2, 30), {
    ...manualReceiptDb,
    settings: { dailyAutoCheckinEnabled: true },
    notifyUser: async () => { receiptSent += 1; return true; }
  });
  assert.strictEqual(enabledSweep.credited, 0);
  assert.strictEqual(enabledSweep.alreadyClaimed, 1);
  assert.strictEqual(enabledSweep.notificationsSent, 1);
  assert.strictEqual(receiptSent, 1);

  const blocked = await claimNotificationDelivery({
    eventKey: 'blocked', user: { _id: 'blocked', telegramId: '600', telegramBlockedAt: at(5, 1, 0) },
    amount: 5, cycleDay: 1, streak: 1
  }, { ...notificationOptions, notifyUser: async () => { throw new Error('must not send'); } });
  assert.strictEqual(blocked.reason, 'blocked');
  const noMessage = await claimNotificationDelivery({
    eventKey: 'disabled-message', user: { _id: 'disabled-message', telegramId: '601' },
    amount: 5, cycleDay: 1, streak: 1
  }, { ...notificationOptions, settings: { dailyReminderEnabled: false } });
  assert.strictEqual(noMessage.reason, 'notifications_disabled');

  console.log('ALL PASS — automatic daily check-in schedule, atomic idempotency, cycle, rollback, and notification retry');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
