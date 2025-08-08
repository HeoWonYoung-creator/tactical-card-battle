function getSessionRecord(sessions, sessionId, sessionTtlMs) {
  const record = sessions.get(sessionId);
  if (!record) return null;
  if (typeof record === 'number') {
    const upgraded = { userId: record, expiresAt: Date.now() + sessionTtlMs, lastUsedAt: Date.now() };
    sessions.set(sessionId, upgraded);
    return upgraded;
  }
  return record;
}

function getUserIdFromSession(sessions, sessionId, sessionTtlMs) {
  const rec = getSessionRecord(sessions, sessionId, sessionTtlMs);
  if (!rec) return null;
  if (rec.expiresAt && rec.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  // 슬라이딩 만료 연장
  rec.lastUsedAt = Date.now();
  rec.expiresAt = Date.now() + sessionTtlMs;
  sessions.set(sessionId, rec);
  return rec.userId;
}

module.exports = { getSessionRecord, getUserIdFromSession };


