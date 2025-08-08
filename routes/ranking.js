const { z } = require('zod');

module.exports = function registerRankingRoutes(app, ctx) {
  const schema = {
    updateTrophies: z.object({
      sessionId: z.string().min(1),
      category: z.enum(['mock']),
      change: z.number().int().min(-5).max(5)
    })
  };

  // 랭킹 조회
  app.get('/api/rankings/:category', (req, res) => {
    try {
      const { category } = req.params;
      if (!ctx.rankings[category]) {
        return res.status(400).json({ error: '유효하지 않은 카테고리입니다.' });
      }
      const rankingData = [];
      for (const [userId, score] of ctx.rankings[category]) {
        const user = ctx.users.get(userId);
        const nickname = user ? user.nickname : `(ID:${userId})`;
        rankingData.push({ userId, nickname, score });
      }
      rankingData.sort((a, b) => b.score - a.score);
      res.json({ success: true, category, rankings: rankingData });
    } catch (error) {
      console.error('❌ 랭킹 조회 오류:', error);
      res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  });

  // 모의 결투 점수 업데이트(클라이언트 허용)
  app.post('/api/update-trophies', (req, res) => {
    try {
      const { sessionId, category, change } = schema.updateTrophies.parse(req.body);
      const userId = ctx.getUserIdFromSession(sessionId);
      if (!userId) return res.status(401).json({ error: '유효하지 않은 세션입니다.' });
      const userData = ctx.users.get(userId);
      if (!userData) return res.status(401).json({ error: '유저 데이터를 찾을 수 없습니다.' });
      const oldScore = userData.trophies.mock || 0;
      const newScore = Math.max(0, oldScore + change);
      userData.trophies.mock = newScore;
      ctx.rankings.mock.set(userId, newScore);
      ctx.saveData();
      res.json({ success: true, trophies: userData.trophies });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: '잘못된 요청 형식입니다.', details: error.issues });
      console.error('❌ 증표 업데이트 오류:', error);
      res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  });
};


