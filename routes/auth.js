const bcrypt = require('bcrypt');
const { z } = require('zod');

module.exports = function registerAuthRoutes(app, ctx) {
  const schema = {
    register: z.object({
      username: z.string().min(3).max(20),
      password: z.string().min(6),
      nickname: z.string().min(2).max(15)
    }),
    login: z.object({
      username: z.string().min(3).max(20),
      password: z.string().min(6)
    }),
    verifySession: z.object({ sessionId: z.string().min(1) }),
    changeNickname: z.object({
      sessionId: z.string().min(1),
      newNickname: z.string().min(2).max(15)
    }),
    changeIcon: z.object({ sessionId: z.string().min(1), icon: z.string().min(1) })
  };

  // 계정 생성
  app.post('/api/register', async (req, res) => {
    try {
      const { username, password, nickname } = schema.register.parse(req.body);

      if (ctx.usernames.has(username)) {
        return res.status(400).json({ error: '이미 사용 중인 아이디입니다.' });
      }
      for (const [, userData] of ctx.users) {
        if (userData.nickname === nickname) {
          return res.status(400).json({ error: '이미 사용 중인 닉네임입니다.' });
        }
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const userId = ctx.generateUserId();
      const userData = {
        userId,
        username,
        nickname,
        password: hashedPassword,
        icon: '👤',
        trophies: { mock: 0, formal: 0 },
        stats: {
          mock: { wins: 0, losses: 0 },
          formal: { wins: 0, losses: 0 }
        },
        currentWinStreak: 0,
        maxWinStreak: 0,
        lastNicknameChange: 0,
        createdAt: Date.now()
      };

      ctx.users.set(userId, userData);
      ctx.usernames.set(username, userId);
      ctx.rankings.mock.set(userId, 0);
      ctx.rankings.formal.set(userId, 0);

      const sessionId = ctx.generateSessionId();
      ctx.sessions.set(sessionId, { userId, expiresAt: Date.now() + ctx.sessionTtlMs, lastUsedAt: Date.now() });

      ctx.saveData();

      res.json({ success: true, sessionId, userData: { userId, username, nickname, icon: userData.icon, trophies: userData.trophies, stats: userData.stats, currentWinStreak: userData.currentWinStreak, maxWinStreak: userData.maxWinStreak } });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: '잘못된 요청 형식입니다.', details: error.issues });
      }
      console.error('❌ 계정 생성 오류:', error);
      res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  });

  // 로그인
  app.post('/api/login', async (req, res) => {
    try {
      const { username, password } = schema.login.parse(req.body);
      const userId = ctx.usernames.get(username);
      if (!userId) return res.status(400).json({ error: '아이디 또는 비밀번호가 잘못되었습니다.' });
      const userData = ctx.users.get(userId);
      if (!userData) return res.status(400).json({ error: '아이디 또는 비밀번호가 잘못되었습니다.' });

      const isValidPassword = await bcrypt.compare(password, userData.password);
      if (!isValidPassword) return res.status(400).json({ error: '아이디 또는 비밀번호가 잘못되었습니다.' });

      const sessionId = ctx.generateSessionId();
      ctx.sessions.set(sessionId, { userId, expiresAt: Date.now() + ctx.sessionTtlMs, lastUsedAt: Date.now() });

      if (!userData.icon) {
        userData.icon = '👤';
        ctx.saveData();
      }

      res.json({ success: true, sessionId, userData: { userId, username, nickname: userData.nickname, icon: userData.icon, trophies: userData.trophies } });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: '잘못된 요청 형식입니다.', details: error.issues });
      }
      console.error('❌ 로그인 오류:', error);
      res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  });

  // 세션 확인
  app.post('/api/verify-session', (req, res) => {
    try {
      const { sessionId } = schema.verifySession.parse(req.body);
      const userId = ctx.getUserIdFromSession(sessionId);
      if (!userId) return res.status(401).json({ error: '유효하지 않은 세션입니다.' });
      const userData = ctx.users.get(userId);
      if (!userData) return res.status(401).json({ error: '유저 데이터를 찾을 수 없습니다.' });
      if (!userData.icon) { userData.icon = '👤'; ctx.saveData(); }
      res.json({ success: true, userData: { userId, username: userData.username, nickname: userData.nickname, icon: userData.icon, trophies: userData.trophies } });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: '잘못된 요청 형식입니다.', details: error.issues });
      console.error('❌ 세션 확인 오류:', error);
      res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  });

  // 닉네임 변경
  app.post('/api/change-nickname', (req, res) => {
    try {
      const { sessionId, newNickname } = schema.changeNickname.parse(req.body);
      const userId = ctx.getUserIdFromSession(sessionId);
      if (!userId) return res.status(401).json({ error: '유효하지 않은 세션입니다.' });
      const userData = ctx.users.get(userId);
      if (!userData) return res.status(401).json({ error: '유저 데이터를 찾을 수 없습니다.' });

      const now = Date.now();
      const oneHour = 60 * 60 * 1000;
      if (userData.lastNicknameChange && (now - userData.lastNicknameChange) < oneHour) {
        const remainingTime = Math.ceil((oneHour - (now - userData.lastNicknameChange)) / (60 * 1000));
        return res.status(400).json({ error: `닉네임 변경은 1시간에 1번만 가능합니다. ${remainingTime}분 후에 다시 시도해주세요.` });
      }
      for (const [, other] of ctx.users) {
        if (other.userId !== userId && other.nickname === newNickname) {
          return res.status(400).json({ error: '이미 사용 중인 닉네임입니다.' });
        }
      }
      const oldNickname = userData.nickname;
      userData.nickname = newNickname;
      userData.lastNicknameChange = now;
      ctx.saveData();
      console.log(`🔄 닉네임 변경: ${oldNickname} -> ${newNickname}`);
      res.json({ success: true, userData: { userId, username: userData.username, nickname: userData.nickname, trophies: userData.trophies } });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: '잘못된 요청 형식입니다.', details: error.issues });
      console.error('❌ 닉네임 변경 오류:', error);
      res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  });

  // 아이콘 변경
  app.post('/api/change-icon', (req, res) => {
    try {
      const { sessionId, icon } = schema.changeIcon.parse(req.body);
      const userId = ctx.getUserIdFromSession(sessionId);
      if (!userId) return res.status(401).json({ error: '유효하지 않은 세션입니다.' });
      const userData = ctx.users.get(userId);
      if (!userData) return res.status(401).json({ error: '유저 데이터를 찾을 수 없습니다.' });
      if (!icon || icon.trim() === '') return res.status(400).json({ error: '아이콘을 선택해주세요.' });
      userData.icon = icon;
      ctx.saveData();
      res.json({ success: true, icon });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: '잘못된 요청 형식입니다.', details: error.issues });
      console.error('❌ 아이콘 변경 오류:', error);
      res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  });
};


