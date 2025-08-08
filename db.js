require('dotenv').config();
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = process.env.DB_PATH || path.join(DATA_DIR, 'game.db');

let db = null;

function init() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      userId INTEGER PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      nickname TEXT NOT NULL,
      password TEXT NOT NULL,
      icon TEXT,
      trophiesMock INTEGER NOT NULL DEFAULT 0,
      trophiesFormal INTEGER NOT NULL DEFAULT 0,
      lastNicknameChange INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sessionId TEXT PRIMARY KEY,
      userId INTEGER NOT NULL,
      expiresAt INTEGER,
      lastUsedAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS rankings (
      category TEXT NOT NULL,
      userId INTEGER NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (category, userId)
    );
  `);
}

function hasAnyData() {
  const row = db.prepare('SELECT (SELECT COUNT(*) FROM users) AS u, (SELECT COUNT(*) FROM rankings) AS r, (SELECT COUNT(*) FROM sessions) AS s').get();
  return (row.u + row.r + row.s) > 0;
}

function loadUsers() {
  const rows = db.prepare('SELECT * FROM users').all();
  const users = new Map();
  for (const r of rows) {
    users.set(r.userId, {
      userId: r.userId,
      username: r.username,
      nickname: r.nickname,
      password: r.password,
      icon: r.icon || '👤',
      trophies: { mock: r.trophiesMock || 0, formal: r.trophiesFormal || 0 },
      lastNicknameChange: r.lastNicknameChange || 0,
      createdAt: r.createdAt
    });
  }
  return users;
}

function loadUsernamesIndex(users) {
  const idx = new Map();
  for (const [uid, u] of users) {
    idx.set(u.username, uid);
  }
  return idx;
}

function loadSessions() {
  const rows = db.prepare('SELECT * FROM sessions').all();
  const sessions = new Map();
  for (const r of rows) {
    sessions.set(r.sessionId, { userId: r.userId, expiresAt: r.expiresAt, lastUsedAt: r.lastUsedAt });
  }
  return sessions;
}

function loadRankings() {
  const rows = db.prepare('SELECT * FROM rankings').all();
  const mock = new Map();
  const formal = new Map();
  for (const r of rows) {
    if (r.category === 'mock') mock.set(r.userId, r.score);
    if (r.category === 'formal') formal.set(r.userId, r.score);
  }
  return { mock, formal };
}

function upsertUsers(usersMap) {
  const stmt = db.prepare(`INSERT INTO users (userId, username, nickname, password, icon, trophiesMock, trophiesFormal, lastNicknameChange, createdAt)
    VALUES (@userId, @username, @nickname, @password, @icon, @trophiesMock, @trophiesFormal, @lastNicknameChange, @createdAt)
    ON CONFLICT(userId) DO UPDATE SET
      username=excluded.username,
      nickname=excluded.nickname,
      password=excluded.password,
      icon=excluded.icon,
      trophiesMock=excluded.trophiesMock,
      trophiesFormal=excluded.trophiesFormal,
      lastNicknameChange=excluded.lastNicknameChange,
      createdAt=excluded.createdAt
  `);
  const trx = db.transaction((arr) => {
    for (const u of arr) stmt.run(u);
  });
  const arr = [];
  for (const [userId, user] of usersMap) {
    arr.push({
      userId,
      username: user.username,
      nickname: user.nickname,
      password: user.password,
      icon: user.icon || '👤',
      trophiesMock: user.trophies?.mock || 0,
      trophiesFormal: user.trophies?.formal || 0,
      lastNicknameChange: user.lastNicknameChange || 0,
      createdAt: user.createdAt
    });
  }
  trx(arr);
}

function upsertSessions(sessionsMap) {
  const stmt = db.prepare(`INSERT INTO sessions (sessionId, userId, expiresAt, lastUsedAt)
    VALUES (@sessionId, @userId, @expiresAt, @lastUsedAt)
    ON CONFLICT(sessionId) DO UPDATE SET
      userId=excluded.userId,
      expiresAt=excluded.expiresAt,
      lastUsedAt=excluded.lastUsedAt
  `);
  const trx = db.transaction((arr) => {
    for (const s of arr) stmt.run(s);
  });
  const arr = [];
  for (const [sid, val] of sessionsMap) {
    if (typeof val === 'number') {
      arr.push({ sessionId: sid, userId: val, expiresAt: null, lastUsedAt: null });
    } else {
      arr.push({ sessionId: sid, userId: val.userId, expiresAt: val.expiresAt || null, lastUsedAt: val.lastUsedAt || null });
    }
  }
  trx(arr);
}

function upsertRankings(rankings) {
  const stmt = db.prepare(`INSERT INTO rankings (category, userId, score)
    VALUES (@category, @userId, @score)
    ON CONFLICT(category, userId) DO UPDATE SET score=excluded.score
  `);
  const trx = db.transaction((arr) => {
    for (const r of arr) stmt.run(r);
  });
  const arr = [];
  for (const [uid, score] of rankings.mock) {
    arr.push({ category: 'mock', userId: uid, score });
  }
  for (const [uid, score] of rankings.formal) {
    arr.push({ category: 'formal', userId: uid, score });
  }
  trx(arr);
}

module.exports = {
  init,
  hasAnyData,
  loadUsers,
  loadUsernamesIndex,
  loadSessions,
  loadRankings,
  upsertUsers,
  upsertSessions,
  upsertRankings
};


