'use strict';

const assert = require('node:assert/strict');
const router = require('../routes/admin');
const VipSubscription = require('../models/VipSubscription');

function getHandler(path) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods.get);
  assert.ok(layer, `GET ${path} should be registered`);
  return layer.route.stack.at(-1).handle;
}

async function invoke(path, req) {
  let statusCode = 200;
  let body;
  await getHandler(path)(req, {
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; }
  }, error => { throw error; });
  return { statusCode, body };
}

(async () => {
  const originalAggregate = VipSubscription.aggregate;
  const originalDistinct = VipSubscription.distinct;
  const originalFindById = VipSubscription.findById;
  try {
    VipSubscription.aggregate = async pipeline => {
      assert.ok(Array.isArray(pipeline));
      return [{
        totalVipPurchases: 3,
        activeVips: 1,
        expiredVips: 1,
        cancelledVips: 1,
        totalVipRevenuePoints: 6000,
        totalDailyVipEarningsPoints: 4
      }];
    };
    VipSubscription.distinct = async field => {
      assert.equal(field, 'user');
      return ['user-1', 'user-2'];
    };
    const summary = await invoke('/vip/summary', { query: {} });
    assert.equal(summary.statusCode, 200);
    assert.equal(summary.body.totalVipPurchases, 3);
    assert.equal(summary.body.totalVipUsers, 2);
    assert.equal(summary.body.totalVipRevenuePoints, 6000);

    let listPipeline;
    VipSubscription.aggregate = async pipeline => {
      listPipeline = pipeline;
      return [{
        items: [{
          _id: 'subscription-1',
          user: { _id: 'mongo-user-1', telegramId: '700001', username: 'test_user', firstName: 'Test', lastName: 'Person' },
          planNumber: 2,
          pricePoints: 2000,
          durationDays: 30,
          dailyRewardAveragePoints: 4,
          totalRewardPoints: 120,
          claimedRewardPoints: 25,
          claimsCompleted: 6,
          startAt: '2026-10-04T00:00:00.000Z',
          endAt: '2026-10-07T00:00:00.000Z',
          createdAt: '2026-10-04T00:00:00.000Z',
          status: 'active',
          displayStatus: 'active'
        }],
        metadata: [{ total: 1 }]
      }];
    };
    const list = await invoke('/vip/subscriptions', {
      query: { search: 'test_user', planNumber: '2', status: 'active', dateFrom: '2026-10-01', dateTo: '2026-10-31', page: '1', limit: '25' }
    });
    assert.equal(list.statusCode, 200);
    assert.equal(list.body.total, 1);
    assert.equal(list.body.subscriptions[0].userId, '700001');
    assert.equal(list.body.subscriptions[0].remainingEarningPoints, 95);
    assert.ok(listPipeline.some(stage => stage.$lookup));
    assert.ok(listPipeline.some(stage => stage.$facet));

    const invalidFilter = await invoke('/vip/subscriptions', { query: { status: 'unknown' } });
    assert.equal(invalidFilter.statusCode, 400);
    assert.equal(invalidFilter.body.code, 'VIP_FILTER_INVALID');

    VipSubscription.findById = id => {
      assert.equal(id, '507f1f77bcf86cd799439011');
      return {
        populate() { return this; },
        async lean() {
          return {
            _id: id,
            user: { _id: 'mongo-user-1', telegramId: '700001', username: 'test_user', firstName: 'Test' },
            planNumber: 1,
            pricePoints: 1000,
            durationDays: 30,
            totalRewardPoints: 50,
            dailyRewardAveragePoints: 1.67,
            claimedRewardPoints: 0,
            claimsCompleted: 0,
            startAt: '2026-10-04T00:00:00.000Z',
            endAt: '2026-11-03T00:00:00.000Z',
            createdAt: '2026-10-04T00:00:00.000Z',
            status: 'active'
          };
        }
      };
    };
    const details = await invoke('/vip/subscriptions/:id', { params: { id: '507f1f77bcf86cd799439011' } });
    assert.equal(details.statusCode, 200);
    assert.equal(details.body.subscription.userId, '700001');
    assert.equal(details.body.subscription.status, 'active');

    console.log('Admin VIP read-route regression tests passed (mocked data; no database connection).');
  } finally {
    VipSubscription.aggregate = originalAggregate;
    VipSubscription.distinct = originalDistinct;
    VipSubscription.findById = originalFindById;
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
