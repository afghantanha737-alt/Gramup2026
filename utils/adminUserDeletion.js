'use strict';

const USER_DELETION_CONFIRMATION_PREFIX = 'DELETE USER';
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

function userDeletionConfirmation(userId) {
  const id = String(userId || '').trim();
  return OBJECT_ID_PATTERN.test(id) ? `${USER_DELETION_CONFIRMATION_PREFIX} ${id}` : '';
}

function hasUserDeletionConfirmation(value, userId) {
  const expected = userDeletionConfirmation(userId);
  return Boolean(expected) && typeof value === 'string' && value === expected;
}

module.exports = {
  USER_DELETION_CONFIRMATION_PREFIX,
  userDeletionConfirmation,
  hasUserDeletionConfirmation
};
