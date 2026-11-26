'use strict';

/**
 * منطق خالص وضعیت برداشت (بدون دیتابیس) — قابل تست مستقل.
 * enum واقعی مدل: pending, approved, processing, paid, rejected, cancelled
 *
 * تصمیم معماری مهم: تایید نهایی پرداخت (endpoint موجود «/approve» که txHash می‌گیرد
 * و پول را جابه‌جا می‌کند) و رد با بازگشت وجه («/reject») دست‌نخورده ماندند — چون
 * قبلاً با دقت زیاد در برابر race condition تست شده بودند. «approved» و «processing»
 * فقط یک لایه‌ی نمایشی/اطلاع‌رسانی روی مرحله‌ی «pending» هستند و پولی جابه‌جا نمی‌کنند؛
 * پول فقط در «paid» (واریز) و «cancelled»/«rejected» (بازگشت) جابه‌جا می‌شود.
 */

const TERMINAL = new Set(['paid', 'rejected', 'cancelled']);

const TRANSITIONS = {
  pending: ['approved', 'processing', 'paid', 'rejected', 'cancelled'],
  approved: ['processing', 'paid', 'cancelled'],
  processing: ['paid', 'cancelled'],
  paid: [],
  rejected: [],
  cancelled: []
};

const STATUSES = Object.keys(TRANSITIONS);

function canTransition(from, to) {
  if (!TRANSITIONS[from] || !STATUSES.includes(to)) return false;
  return TRANSITIONS[from].includes(to);
}

function isTerminal(status) {
  return TERMINAL.has(status);
}

/** رد و لغو باید همیشه دلیل داشته باشند (هم فرانت و هم اینجا سمت سرور چک می‌شود) */
function requiresReason(status) {
  return status === 'rejected' || status === 'cancelled';
}

/** آیا این انتقال باید USDT را به کاربر برگرداند؟ (چون در لحظه‌ی درخواست از موجودی کسر شده) */
function shouldRefund(status) {
  return status === 'rejected' || status === 'cancelled';
}

/**
 * برای رکوردهای قدیمی که فیلد statusHistory ندارند (قبل از این قابلیت ساخته شده‌اند)،
 * یک Timeline قابل‌قبول از روی فیلدهای همیشه‌موجود (createdAt/paidAt/updatedAt/status)
 * می‌سازد — بدون نیاز به اسکریپت migration روی دیتابیس.
 */
function synthesizeHistory(withdrawal) {
  if (Array.isArray(withdrawal.statusHistory) && withdrawal.statusHistory.length > 0) {
    return withdrawal.statusHistory
      .map(entry => ({ status: entry.status, at: entry.at, note: entry.note || '' }))
      .sort((a, b) => new Date(a.at) - new Date(b.at));
  }

  const timeline = [{ status: 'pending', at: withdrawal.createdAt, note: '' }];
  if (withdrawal.status === 'paid') {
    timeline.push({ status: 'paid', at: withdrawal.paidAt || withdrawal.updatedAt, note: '' });
  } else if (withdrawal.status === 'rejected' || withdrawal.status === 'cancelled') {
    timeline.push({ status: withdrawal.status, at: withdrawal.updatedAt, note: withdrawal.adminNote || '' });
  }
  return timeline;
}

module.exports = { STATUSES, TRANSITIONS, canTransition, isTerminal, requiresReason, shouldRefund, synthesizeHistory };
