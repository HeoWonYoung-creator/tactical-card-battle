const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const RANKINGS_FILE = path.join(DATA_DIR, 'rankings.json');
const MAX_RANKS_PER_DIFFICULTY = 200; // 저장 상한
const DISPLAY_RANKS = 50; // 조회 상한

// 미들웨어
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // 정적 파일: html, 이미지, 폰트 등

// 데이터 디렉토리 및 파일 보장
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}
if (!fs.existsSync(RANKINGS_FILE)) {
  fs.writeFileSync(RANKINGS_FILE, JSON.stringify({}, null, 2), 'utf8');
}

// 랭킹 로드
let rankings = {};
try {
  rankings = JSON.parse(fs.readFileSync(RANKINGS_FILE, 'utf8')) || {};
} catch (e) {
  console.error('랭킹 파일 읽기 오류:', e);
  rankings = {};
}

function saveRankings() {
  try {
    fs.writeFileSync(RANKINGS_FILE, JSON.stringify(rankings, null, 2), 'utf8');
  } catch (e) {
    console.error('랭킹 파일 저장 오류:', e);
  }
}

// 헬스체크
app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Server is healthy' });
});

// 랭킹 조회
app.get('/api/rank', (req, res) => {
  const handSize = req.query.hand;
  if (!handSize) {
    return res.status(400).json({ error: 'hand parameter is required' });
  }
  const current = (rankings[handSize] || [])
    .slice()
    .sort((a, b) => a.ms - b.ms)
    .slice(0, DISPLAY_RANKS);
  res.json({ hand: handSize, ranks: current });
});

// 점수 제출
app.post('/api/submit', (req, res) => {
  const { hand, nickname, ms } = req.body || {};
  if (!hand || !nickname || typeof ms !== 'number' || !(ms > 0)) {
    return res.status(400).json({ error: 'Invalid submission data' });
  }
  const cleanNickname = String(nickname).trim().slice(0, 20);
  if (!cleanNickname) {
    return res.status(400).json({ error: 'Nickname cannot be empty' });
  }
  if (!rankings[hand]) rankings[hand] = [];
  rankings[hand].push({ nickname: cleanNickname, ms, at: new Date().toISOString() });
  rankings[hand].sort((a, b) => a.ms - b.ms);
  rankings[hand] = rankings[hand].slice(0, MAX_RANKS_PER_DIFFICULTY);
  saveRankings();
  res.json({ ok: true, message: 'Score submitted successfully' });
});

// 루트에서 게임 페이지 제공
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'card-rush.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});


