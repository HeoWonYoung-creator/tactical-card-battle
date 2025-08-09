require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const helmetModule = require('helmet');
const helmet = typeof helmetModule === 'function' ? helmetModule : helmetModule.default;
const rateLimit = require('express-rate-limit').default;
const pino = require('pino');
const pinoHttpModule = require('pino-http');
const pinoHttp = typeof pinoHttpModule === 'function' ? pinoHttpModule : pinoHttpModule.default;
const client = require('prom-client');
const { z } = require('zod');

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
    cors: {
        origin: process.env.CORS_ORIGIN || "*",
        methods: ["GET", "POST"]
    },
    // 연결 안정성 개선
    pingTimeout: Number(process.env.SIO_PING_TIMEOUT_MS || 60000),
    pingInterval: Number(process.env.SIO_PING_INTERVAL_MS || 25000),
    transports: ['websocket', 'polling']
});

// CORS & 보안 헤더 & JSON 파서
app.use(cors());
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: false,
        directives: {
            defaultSrc: ["'self'"],
            imgSrc: ["'self'", 'data:'],
            styleSrc: [
                "'self'",
                "'unsafe-inline'",
                'https://fonts.googleapis.com'
            ],
            fontSrc: [
                "'self'",
                'https://fonts.gstatic.com',
                'data:'
            ],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                'https://cdn.tailwindcss.com',
                'https://cdn.socket.io'
            ],
            connectSrc: ["'self'", 'ws:', 'wss:'],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            frameAncestors: ["'self'"],
            upgradeInsecureRequests: []
        }
    }
}));
app.use(express.json({ limit: '100kb' }));
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
app.use(pinoHttp({ logger }));

// 레이트리밋: API 엔드포인트 보호
const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1분
    max: 100, // 분당 100 요청
    standardHeaders: true,
    legacyHeaders: false
});
app.use('/api/', apiLimiter);

// 라우터에서 독립 스키마 사용

// 정적 파일 제공 개선: 공개 디렉토리만 서빙 (data 등 민감 경로 차단)
app.use(express.static(path.join(__dirname, 'public')));

// 메인 페이지 라우트
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'webrtc-multiplayer.html'));
});

// webrtc-multiplayer.html 직접 라우트
app.get('/webrtc-multiplayer.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'webrtc-multiplayer.html'));
});

// 필요한 정적 자산만 선택적으로 제공 (전체 디렉토리 서빙 방지)
app.get('/magic_battle.png', (req, res) => {
    res.sendFile(path.join(__dirname, 'magic_battle.png'));
});

// ICE 서버 설정 노출 (TURN/STUN 구성 환경변수화)
app.get('/api/webrtc-ice', (req, res) => {
    const iceServers = [];
    const stun = process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302';
    stun.split(',').map(s => s.trim()).filter(Boolean).forEach(url => iceServers.push({ urls: url }));
    const turn = process.env.TURN_URLS || '';
    const turnUser = process.env.TURN_USERNAME || '';
    const turnCred = process.env.TURN_CREDENTIAL || '';
    if (turn) {
        turn.split(',').map(s => s.trim()).filter(Boolean).forEach(url => {
            const entry = { urls: url };
            if (turnUser) entry.username = turnUser;
            if (turnCred) entry.credential = turnCred;
            iceServers.push(entry);
        });
    }
    res.json({ success: true, iceServers });
});

// Prometheus 메트릭 설정
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics();
const connectionsGauge = new client.Gauge({ name: 'server_total_connections', help: 'Total connections' });
const activeGamesGauge = new client.Gauge({ name: 'server_active_games', help: 'Active games' });
const waitingPlayersGauge = new client.Gauge({ name: 'server_waiting_players', help: 'Waiting players' });
const totalMatchesCounter = new client.Counter({ name: 'server_total_matches', help: 'Total matches' });

app.get('/metrics', async (req, res) => {
    try {
        res.set('Content-Type', client.register.contentType);
        res.end(await client.register.metrics());
    } catch (err) {
        res.status(500).end(err.message);
    }
});

// 컨텍스트 구성 및 라우터 등록은 데이터 구조 선언 이후에 수행됨

// 라우터 등록은 서버 시작 후 컨텍스트 초기화 시점에 수행됨

// favicon.ico 라우트 추가
app.get('/favicon.ico', (req, res) => {
    // SVG 형태의 favicon 반환
    const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <rect width="100" height="100" fill="#f8f9fa"/>
        <text x="50" y="70" font-size="60" text-anchor="middle" fill="#333">🏆</text>
    </svg>`;
    
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svgIcon);
});



// 게임 상태 관리
const waitingPlayers = new Map(); // 대기 중인 플레이어들
const activeGames = new Map(); // 활성 게임들
const playerSessions = new Map(); // 플레이어 세션 관리
const gameStates = new Map(); // 게임 상태 저장

// 계정 시스템
const users = new Map(); // userId -> userData
const usernames = new Map(); // username -> userId
const sessions = new Map(); // sessionId -> { userId, expiresAt, lastUsedAt } (구버전 숫자 지원)
let nextUserId = 1;

// 랭킹 시스템 (userId -> score)
const rankings = {
    mock: new Map(),
    formal: new Map()
};

// 게임 결과 합의 대기 저장소 (gameId -> { claims: Map<socketId, winnerSocketId> })
const pendingResults = new Map();

// 파일 시스템을 사용한 영구 저장소 + DB
const fs = require('fs');
const fsp = require('fs').promises;
const db = require('./db');
const { getSessionRecord, getUserIdFromSession: getUserIdFromSessionUtil } = require('./utils/session');
const { getGameIdOf: getGameIdOfUtil, getOpponentSocketId: getOpponentSocketIdUtil, arePlayersInSameGame: arePlayersInSameGameUtil } = require('./utils/game');

// 데이터 파일 경로
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const RANKINGS_FILE = path.join(DATA_DIR, 'rankings.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

// 데이터 디렉토리 생성
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('📁 데이터 디렉토리 생성됨');
}

/**
 * 데이터 로드 함수
 */
function loadData() {
    try {
        console.log('📁 데이터 파일 확인 중...');
        // DB 초기화 및 선로딩
        db.init();
        if (db.hasAnyData()) {
            // DB 우선 로드
            const loadedUsers = db.loadUsers();
            users.clear();
            usernames.clear();
            for (const [uid, u] of loadedUsers) {
                users.set(uid, u);
            }
            const usernameIdx = db.loadUsernamesIndex(users);
            for (const [uname, uid] of usernameIdx) {
                usernames.set(uname, uid);
            }
            const loadedSessions = db.loadSessions();
            sessions.clear();
            for (const [sid, val] of loadedSessions) {
                sessions.set(sid, val);
            }
            const loadedRankings = db.loadRankings();
            rankings.mock = loadedRankings.mock;
            rankings.formal = loadedRankings.formal;
            nextUserId = Math.max(...Array.from(users.keys()), 0) + 1;
            console.log(`🗄️ DB로부터 데이터 로드: 유저 ${users.size}, 세션 ${sessions.size}, mock ${rankings.mock.size}, formal ${rankings.formal.size}`);
            return;
        }
        
        // 유저 데이터 로드
        if (fs.existsSync(USERS_FILE)) {
            try {
                const usersData = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
                users.clear();
                usernames.clear();
                
                for (const [userId, userData] of Object.entries(usersData)) {
                    users.set(parseInt(userId), userData);
                    usernames.set(userData.username, parseInt(userId));
                }
                nextUserId = Math.max(...Object.keys(usersData).map(Number), 0) + 1;
                console.log(`👤 유저 데이터 로드됨: ${users.size}명, 다음 ID: ${nextUserId}`);
                
                // 기존 유저들을 랭킹에 등록 (없는 경우에만) — userId 기반
                for (const [userId, userData] of users) {
                    if (!rankings.mock.has(userId)) {
                        rankings.mock.set(userId, userData.trophies.mock || 0);
                    }
                    if (!rankings.formal.has(userId)) {
                        rankings.formal.set(userId, userData.trophies.formal || 0);
                    }
                }
            } catch (error) {
                console.error('❌ 유저 데이터 파일 파싱 오류:', error);
                users.clear();
                usernames.clear();
                nextUserId = 1;
            }
        }
        
        // 랭킹 데이터 로드
        if (fs.existsSync(RANKINGS_FILE)) {
            try {
                const rankingsData = JSON.parse(fs.readFileSync(RANKINGS_FILE, 'utf8'));
                rankings.mock = new Map(rankingsData.mock || []);
                rankings.formal = new Map(rankingsData.formal || []);
                // 닉네임 키였던 기존 데이터를 userId 키로 마이그레이션
                migrateRankingKeysToUserId(rankings.mock);
                migrateRankingKeysToUserId(rankings.formal);
                console.log(`📊 랭킹 데이터 로드됨: 모의 ${rankings.mock.size}명, 정식 ${rankings.formal.size}명`);
            } catch (error) {
                console.error('❌ 랭킹 데이터 파일 파싱 오류:', error);
                rankings.mock.clear();
                rankings.formal.clear();
            }
        }
        
        // 세션 데이터 로드
        if (fs.existsSync(SESSIONS_FILE)) {
            try {
                const sessionsData = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
                sessions.clear();
                for (const [sessionId, value] of Object.entries(sessionsData)) {
                    if (typeof value === 'object' && value !== null) {
                        sessions.set(sessionId, {
                            userId: parseInt(value.userId),
                            expiresAt: value.expiresAt || (Date.now() + SESSION_TTL_MS),
                            lastUsedAt: value.lastUsedAt || Date.now()
                        });
                    } else {
                        sessions.set(sessionId, parseInt(value));
                    }
                }
                console.log(`🔐 세션 데이터 로드됨: ${sessions.size}개`);
            } catch (error) {
                console.error('❌ 세션 데이터 파일 파싱 오류:', error);
                sessions.clear();
            }
        }
        
    } catch (error) {
        console.error('❌ 데이터 로드 중 오류:', error);
    }
}

/**
 * 데이터 저장 함수
 */
const SAVE_DEBOUNCE_MS = Number(process.env.SAVE_DEBOUNCE_MS || 200);
let saveTimer = null;
async function saveDataImmediate() {
    try {
        // 유저 데이터 저장
        const usersData = {};
        for (const [userId, userData] of users) {
            usersData[userId] = userData;
        }
        await fsp.writeFile(USERS_FILE, JSON.stringify(usersData, null, 2));
        
        // 랭킹 데이터 저장 (userId -> score)
        const rankingsData = {
            mock: Array.from(rankings.mock.entries()),
            formal: Array.from(rankings.formal.entries())
        };
        await fsp.writeFile(RANKINGS_FILE, JSON.stringify(rankingsData, null, 2));
        
        // 세션 데이터 저장
        const sessionsData = {};
        for (const [sessionId, value] of sessions) {
            if (typeof value === 'number') {
                sessionsData[sessionId] = { userId: value, expiresAt: Date.now() + SESSION_TTL_MS, lastUsedAt: Date.now() };
            } else {
                sessionsData[sessionId] = value;
            }
        }
        await fsp.writeFile(SESSIONS_FILE, JSON.stringify(sessionsData, null, 2));
        
        console.log('💾 데이터 저장 완료');
    } catch (error) {
        console.error('❌ 데이터 저장 중 오류:', error);
    }
}

function saveData() {
    if (saveTimer) {
        clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
        saveDataImmediate();
        // DB에도 동기화
        try {
            db.upsertUsers(users);
            db.upsertSessions(sessions);
            db.upsertRankings(rankings);
        } catch (e) {
            console.error('❌ DB 동기화 실패:', e);
        }
    }, SAVE_DEBOUNCE_MS);
}

// 세션 유효기간
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || (24 * 60 * 60 * 1000));

function getUserIdFromSession(sessionId) {
    return getUserIdFromSessionUtil(sessions, sessionId, SESSION_TTL_MS);
}

function migrateRankingKeysToUserId(rankMap) {
    for (const [key, score] of Array.from(rankMap.entries())) {
        if (typeof key === 'string' && isNaN(Number(key))) {
            // 닉네임인 경우 userId 찾기
            let foundUserId = null;
            for (const [uid, udata] of users) {
                if (udata.nickname === key) {
                    foundUserId = uid;
                    break;
                }
            }
            rankMap.delete(key);
            if (foundUserId !== null) {
                rankMap.set(foundUserId, score);
            }
        } else if (typeof key === 'string') {
            const numKey = Number(key);
            rankMap.delete(key);
            rankMap.set(numKey, score);
        }
    }
}

/**
 * 경기 결과 확정 및 점수 반영 (서버 권위)
 */
function finalizeGameResult(gameId, winnerSocketId) {
    const session = activeGames.get(gameId);
    if (!session) return;
    const loser = session.players.find(p => p.id !== winnerSocketId);
    const winner = session.players.find(p => p.id === winnerSocketId);
    if (!winner || !loser) return;

    // 게스트 경기면 점수 반영 안 함
    if (winner.isGuest || loser.isGuest) {
        return;
    }

    // 유저 데이터 확보
    const winnerInfo = playerSessions.get(winner.id);
    const loserInfo = playerSessions.get(loser.id);
    if (!winnerInfo || !loserInfo) return;

    const winnerUser = users.get(winnerInfo.userId);
    const loserUser = users.get(loserInfo.userId);
    if (!winnerUser || !loserUser) return;

    // 정식 결투 점수: 승리 +2, 패배 -1 (하한 0)
    const winnerCurrent = winnerUser.trophies.formal || 0;
    const loserCurrent = loserUser.trophies.formal || 0;
    const winnerUpdated = Math.max(0, winnerCurrent + 2);
    const loserUpdated = Math.max(0, loserCurrent - 1);
    winnerUser.trophies.formal = winnerUpdated;
    loserUser.trophies.formal = loserUpdated;
    rankings.formal.set(winnerInfo.userId, winnerUpdated);
    rankings.formal.set(loserInfo.userId, loserUpdated);
    saveData();
    console.log(`🏆 정식 결투 결과 확정: ${winnerUser.nickname} 승리 (+2), ${loserUser.nickname} 패배 (-1)`);
}

/**
 * 세션 ID 생성
 */
function generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
}

// 라우터로 위임: routes/auth.js

// 라우터로 위임: routes/auth.js

/**
 * 세션 확인 API
 */
// 라우터로 위임: routes/auth.js

/**
 * 닉네임 변경 API
 */
// 라우터로 위임: routes/auth.js

/**
 * 아이콘 변경 API
 */
// 라우터로 위임: routes/auth.js

/**
 * 랭킹 조회 API
 */
// 라우터로 위임: routes/ranking.js

/**
 * 승리의 증표 업데이트 API
 */
// 라우터로 위임: routes/ranking.js

/**
 * 유저 프로필 조회 API
 */
app.get('/api/profile/:userId', (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        
        if (!userId || userId <= 0) {
            return res.status(400).json({ error: '유효하지 않은 유저 ID입니다.' });
        }
        
        const userData = users.get(userId);
        if (!userData) {
            return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        }
        
        // 기본 정보만 반환 (비밀번호 제외)
        const profileData = {
            userId: userData.userId,
            username: userData.username,
            nickname: userData.nickname,
            icon: userData.icon || '👤',
            trophies: userData.trophies,
            createdAt: userData.createdAt,
            lastNicknameChange: userData.lastNicknameChange
        };
        
        console.log(`👤 프로필 조회: ${userData.nickname} (ID: ${userId})`);
        
        res.json({
            success: true,
            userData: profileData
        });
        
    } catch (error) {
        console.error('❌ 프로필 조회 오류:', error);
        res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
});

// 서버 상태
let serverStats = {
    totalConnections: 0,
    activeGames: 0,
    waitingPlayers: 0,
    totalMatches: 0
};

// 에러 핸들링 함수
function handleError(socket, error, context) {
    console.error(`❌ 에러 발생 (${context}):`, error);
    const payload = { message: '서버 오류가 발생했습니다.', context };
    socket.emit('serverError', payload);
    socket.emit('error', payload); // 하위 호환
}

// 연결 상태 확인 함수
function isPlayerConnected(playerId) {
    return io.sockets.sockets.has(playerId);
}

const getGameIdOf = (socketId) => getGameIdOfUtil(playerSessions, socketId);
const getOpponentSocketId = (gameId, socketId) => getOpponentSocketIdUtil(activeGames, gameId, socketId);
const arePlayersInSameGame = (a, b) => arePlayersInSameGameUtil(playerSessions, activeGames, a, b);

// Socket.IO 연결 처리
io.on('connection', (socket) => {
    console.log(`🔌 새로운 연결: ${socket.id}`);
    serverStats.totalConnections++;
    
    // 플레이어 정보 저장
    let playerInfo = {
        id: socket.id,
        name: null,
        isWaiting: false,
        gameId: null,
        opponent: null,
        lastPing: Date.now(),
        connectionAttempts: 0,
        isGuest: true, // 기본값은 게스트
        userId: null,
        sessionId: null
    };
    
    playerSessions.set(socket.id, playerInfo);
    
    // 서버 상태 전송
    socket.emit('serverStats', serverStats);
    
    // 핑/퐁으로 연결 상태 확인
    socket.on('ping', () => {
        playerInfo.lastPing = Date.now();
        socket.emit('pong');
    });
    
    // 계정 로그인
    socket.on('login', (data) => {
        try {
            const { sessionId } = data;
            
            if (!sessionId) {
                socket.emit('loginResult', { success: false, error: '세션 ID가 필요합니다.' });
                return;
            }
            
            const userId = getUserIdFromSession(sessionId);
            if (!userId) {
                socket.emit('loginResult', { success: false, error: '유효하지 않은 세션입니다.' });
                return;
            }
            
            const userData = users.get(userId);
            if (!userData) {
                socket.emit('loginResult', { success: false, error: '유저 데이터를 찾을 수 없습니다.' });
                return;
            }
            
            // 플레이어 정보 업데이트
            playerInfo.isGuest = false;
            playerInfo.userId = userId;
            playerInfo.sessionId = sessionId;
            playerInfo.name = userData.nickname;
            
            console.log(`🔐 소켓 로그인: ${userData.nickname} (${socket.id})`);
            
            socket.emit('loginResult', {
                success: true,
                userData: {
                    userId,
                    username: userData.username,
                    nickname: userData.nickname,
                    trophies: userData.trophies
                }
            });
            
        } catch (error) {
            handleError(socket, error, 'login');
        }
    });
    
    // 매칭 요청
    socket.on('requestMatch', (data) => {
        try {
            // 로그인된 계정이면 서버의 닉네임을 강제 사용하고,
            // 게스트인 경우에만 클라이언트가 보낸 이름을 사용
            let playerName = '게스트';
            if (!playerInfo.isGuest && playerInfo.userId) {
                const u = users.get(playerInfo.userId);
                playerName = (u && u.nickname) ? u.nickname : '게스트';
            } else {
                playerName = data.playerName || '게스트';
            }
            playerInfo.name = playerName;
            playerInfo.isWaiting = true;
            
            console.log(`🎯 매칭 요청: ${playerName} (${socket.id}) - ${playerInfo.isGuest ? '게스트' : '계정'}`);
            
            // 대기 중인 다른 플레이어 찾기
            let matchedPlayer = null;
            for (const [waitingId, waitingPlayer] of waitingPlayers) {
                if (waitingId !== socket.id && isPlayerConnected(waitingId)) {
                    matchedPlayer = waitingPlayer;
                    break;
                }
            }
            
            if (matchedPlayer) {
                // 매칭 성공!
                console.log(`✅ 매칭 성공: ${playerName} ↔ ${matchedPlayer.name}`);
                serverStats.totalMatches++;
                totalMatchesCounter.inc();
                
                // 대기 목록에서 제거
                waitingPlayers.delete(matchedPlayer.id);
                waitingPlayers.delete(socket.id);
                
                // 게임 세션 생성
                const gameId = `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const gameSession = {
                    id: gameId,
                    players: [
                        { id: socket.id, name: playerName, isHost: true, isGuest: playerInfo.isGuest },
                        { id: matchedPlayer.id, name: matchedPlayer.name, isHost: false, isGuest: matchedPlayer.isGuest }
                    ],
                    createdAt: Date.now(),
                    lastActivity: Date.now()
                };
                
                activeGames.set(gameId, gameSession);
                playerInfo.gameId = gameId;
                playerInfo.opponent = matchedPlayer.id;
                
                const matchedPlayerInfo = playerSessions.get(matchedPlayer.id);
                if (matchedPlayerInfo) {
                    matchedPlayerInfo.gameId = gameId;
                    matchedPlayerInfo.opponent = socket.id;
                }

                // 룸 조인
                socket.join(gameId);
                const matchedSocket = io.sockets.sockets.get(matchedPlayer.id);
                if (matchedSocket) {
                    matchedSocket.join(gameId);
                }
                
                // 양쪽 플레이어에게 매칭 성공 알림
                socket.emit('matchFound', {
                    gameId: gameId,
                    opponent: {
                        id: matchedPlayer.id,
                        name: matchedPlayer.name,
                        isGuest: matchedPlayer.isGuest
                    },
                    isHost: true
                });
                
                io.to(matchedPlayer.id).emit('matchFound', {
                    gameId: gameId,
                    opponent: {
                        id: socket.id,
                        name: playerName,
                        isGuest: playerInfo.isGuest
                    },
                    isHost: false
                });
                
                serverStats.activeGames++;
                serverStats.waitingPlayers = Math.max(0, serverStats.waitingPlayers - 2);
                connectionsGauge.set(serverStats.totalConnections);
                activeGamesGauge.set(serverStats.activeGames);
                waitingPlayersGauge.set(serverStats.waitingPlayers);
                
            } else {
                // 대기 목록에 추가
                waitingPlayers.set(socket.id, playerInfo);
                serverStats.waitingPlayers++;
                console.log(`⏳ 대기 중: ${playerName} (총 ${serverStats.waitingPlayers}명)`);
                
                socket.emit('waitingForMatch', {
                    message: '상대방을 찾는 중입니다...',
                    waitingCount: serverStats.waitingPlayers
                });
            }
            
            // 서버 상태 업데이트
            io.emit('serverStats', serverStats);
            
        } catch (error) {
            handleError(socket, error, 'requestMatch');
        }
    });
    
    // WebRTC 시그널링
    socket.on('offer', (data) => {
        try {
            const { target, offer } = data;
            if (isPlayerConnected(target) && arePlayersInSameGame(socket.id, target)) {
                io.to(target).emit('offer', {
                    from: socket.id,
                    offer: offer
                });
            } else {
                const payload = { message: '상대방이 연결되지 않았습니다.', context: 'offer' };
                socket.emit('serverError', payload);
                socket.emit('error', payload); // 하위 호환
            }
        } catch (error) {
            handleError(socket, error, 'offer');
        }
    });
    
    socket.on('answer', (data) => {
        try {
            const { target, answer } = data;
            
            if (isPlayerConnected(target) && arePlayersInSameGame(socket.id, target)) {
                io.to(target).emit('answer', {
                    from: socket.id,
                    answer: answer
                });
            }
        } catch (error) {
            handleError(socket, error, 'answer');
        }
    });
    
    socket.on('iceCandidate', (data) => {
        try {
            const { target, candidate } = data;
            
            if (isPlayerConnected(target) && arePlayersInSameGame(socket.id, target)) {
                io.to(target).emit('iceCandidate', {
                    from: socket.id,
                    candidate: candidate
                });
            }
        } catch (error) {
            handleError(socket, error, 'iceCandidate');
        }
    });
    
    // 게임 상태 동기화
    socket.on('gameState', (data) => {
        try {
            const { target, gameState } = data;
            
            if (isPlayerConnected(target) && arePlayersInSameGame(socket.id, target)) {
                // 게임 상태 저장
                if (playerInfo.gameId) {
                    gameStates.set(playerInfo.gameId, gameState);
                }
                
                io.to(target).emit('gameState', {
                    from: socket.id,
                    gameState: gameState
                });
            }
        } catch (error) {
            handleError(socket, error, 'gameState');
        }
    });
    
    // 카드 플레이
    socket.on('cardPlayed', (data) => {
        try {
            const { target, card, playerId, gameState } = data;
            
            if (isPlayerConnected(target) && arePlayersInSameGame(socket.id, target)) {
                // 게임 상태 업데이트
                if (gameState && playerInfo.gameId) {
                    gameStates.set(playerInfo.gameId, gameState);
                }
                
                io.to(target).emit('cardPlayed', {
                    from: socket.id,
                    card: card,
                    playerId: playerId,
                    gameState: gameState
                });
            }
        } catch (error) {
            handleError(socket, error, 'cardPlayed');
        }
    });
    
    // 턴 종료
    socket.on('turnEnd', (data) => {
        try {
            const { target, gameState } = data;
            
            if (isPlayerConnected(target) && arePlayersInSameGame(socket.id, target)) {
                // 게임 상태 업데이트
                if (gameState && playerInfo.gameId) {
                    gameStates.set(playerInfo.gameId, gameState);
                }
                
                io.to(target).emit('turnEnd', {
                    from: socket.id,
                    gameState: gameState
                });
            }
        } catch (error) {
            handleError(socket, error, 'turnEnd');
        }
    });
    
    // 게임 종료
    socket.on('gameOver', (data) => {
        try {
            const { target, winner, gameState, isGuest } = data;
            
            if (!isPlayerConnected(target) || !arePlayersInSameGame(socket.id, target)) {
                return; // 무시
            }

            const gameId = getGameIdOf(socket.id);
            if (!gameId) return;

            // 상태 저장
            if (gameState) {
                gameStates.set(gameId, gameState);
            }

            // 승자 값 검증 (자기자신 또는 상대)
            const opponentId = getOpponentSocketId(gameId, socket.id);
            if (winner !== socket.id && winner !== opponentId) {
                return; // 유효하지 않은 승자 주장
            }

            // 합의 수집
            if (!pendingResults.has(gameId)) {
                pendingResults.set(gameId, { claims: new Map() });
            }
            const entry = pendingResults.get(gameId);
            entry.claims.set(socket.id, winner);

            // 상대 주장 확인
            const otherClaim = entry.claims.get(opponentId);
            if (otherClaim && otherClaim === winner) {
                // 합의됨 → 결과 확정, 점수 반영
                finalizeGameResult(gameId, winner);
                // 알림
                io.to(opponentId).emit('gameOver', { from: socket.id, winner, gameState, isGuest });
                socket.emit('gameOver', { from: opponentId, winner, gameState, isGuest });
                // 정리
                pendingResults.delete(gameId);
                activeGames.delete(gameId);
                gameStates.delete(gameId);
                serverStats.activeGames = Math.max(0, serverStats.activeGames - 1);
            }
        } catch (error) {
            handleError(socket, error, 'gameOver');
        }
    });
    
    // 연결 해제 처리
    socket.on('disconnect', () => {
        console.log(`🔌 연결 해제: ${socket.id}`);
        
        try {
            // 대기 목록에서 제거
            if (waitingPlayers.has(socket.id)) {
                waitingPlayers.delete(socket.id);
                serverStats.waitingPlayers = Math.max(0, serverStats.waitingPlayers - 1);
                waitingPlayersGauge.set(serverStats.waitingPlayers);
                console.log(`❌ 대기 목록에서 제거: ${socket.id}`);
            }
            
            // 게임 세션에서 제거
            if (playerInfo.gameId) {
                const gameSession = activeGames.get(playerInfo.gameId);
                if (gameSession) {
                    // 상대방에게 연결 해제 알림
            const opponentPlayer = gameSession.players.find(p => p.id !== socket.id);
            const disconnectedPlayer = gameSession.players.find(p => p.id === socket.id);
                    if (opponentPlayer && isPlayerConnected(opponentPlayer.id)) {
                        io.to(opponentPlayer.id).emit('opponentDisconnected', {
                            message: '상대방이 연결을 해제했습니다.',
                            gameId: playerInfo.gameId,
                            disconnectedPlayerName: disconnectedPlayer ? disconnectedPlayer.name : 'Unknown',
                            disconnectedPlayerId: socket.id,
                            isDisconnectedAsLoser: true
                        });
                        // 정식 결투인 경우: 둘 다 계정 유저라면 연결 해제를 패배로 간주하여 점수 반영
                        try {
                            const opponentInfo = playerSessions.get(opponentPlayer.id);
                            if (opponentInfo && opponentInfo.userId && !opponentInfo.isGuest && playerInfo && playerInfo.userId && !playerInfo.isGuest) {
                                const gameId = getGameIdOf(socket.id);
                                if (gameId) {
                                    // 연결 끊긴 쪽을 패배자로 확정
                                    finalizeGameResult(gameId, opponentPlayer.id);
                                }
                            }
                        } catch (e) {
                            console.warn('연결 해제에 따른 결과 확정 실패(무시 가능):', e);
                        }
                    }
                    
                    activeGames.delete(playerInfo.gameId);
                    gameStates.delete(playerInfo.gameId);
                    serverStats.activeGames = Math.max(0, serverStats.activeGames - 1);
                    activeGamesGauge.set(serverStats.activeGames);
                    console.log(`❌ 게임 세션 종료: ${playerInfo.gameId}`);
                }
            }
            
            // 플레이어 세션 제거
            playerSessions.delete(socket.id);
            serverStats.totalConnections = Math.max(0, serverStats.totalConnections - 1);
            connectionsGauge.set(serverStats.totalConnections);
            
            // 서버 상태 업데이트
            io.emit('serverStats', serverStats);
            
        } catch (error) {
            console.error('❌ 연결 해제 처리 중 오류:', error);
        }
    });
    
    // 에러 처리
    socket.on('error', (error) => {
        console.error(`❌ 클라이언트 에러 (${socket.id}):`, error);
    });
});

// 주기적인 연결 상태 확인
setInterval(() => {
    const currentTime = Date.now();
    const timeout = 120000; // 2분
    
    for (const [socketId, playerInfo] of playerSessions) {
        if (currentTime - playerInfo.lastPing > timeout) {
            console.log(`⚠️ 연결 타임아웃: ${socketId}`);
            const targetSocket = io.sockets.sockets.get(socketId);
            if (targetSocket) {
                targetSocket.disconnect(true);
            }
        }
    }
    
    // 오래된 게임 세션 정리
    for (const [gameId, gameSession] of activeGames) {
        if (currentTime - gameSession.lastActivity > 300000) { // 5분
            console.log(`🧹 오래된 게임 세션 정리: ${gameId}`);
            activeGames.delete(gameId);
            gameStates.delete(gameId);
            serverStats.activeGames = Math.max(0, serverStats.activeGames - 1);
        }
    }

    // 만료 세션 정리
    for (const [sid, rec] of Array.from(sessions.entries())) {
        const record = typeof rec === 'number' ? { userId: rec, expiresAt: currentTime + SESSION_TTL_MS, lastUsedAt: currentTime } : rec;
        if (record.expiresAt && record.expiresAt < currentTime) {
            sessions.delete(sid);
        }
    }
}, 30000);

// 서버 상태 모니터링
setInterval(() => {
    console.log(`📊 서버 상태: 연결 ${serverStats.totalConnections}, 게임 ${serverStats.activeGames}, 대기 ${serverStats.waitingPlayers}, 총 매칭 ${serverStats.totalMatches}`);
}, 30000);

// 라우터 컨텍스트 초기화 후 라우터 등록 (404 핸들러보다 반드시 앞)
const ctx = {
    users,
    usernames,
    sessions,
    rankings,
    sessionTtlMs: SESSION_TTL_MS,
    saveData,
    getUserIdFromSession,
    generateUserId: () => nextUserId++,
    generateSessionId
};
require('./routes/auth')(app, ctx);
require('./routes/ranking')(app, ctx);

// 404 에러 처리 (모든 라우트 이후에 등록)
app.use((req, res) => {
    console.log(`404 에러: ${req.method} ${req.url}`);
    
    // API 요청인 경우 JSON 응답
    if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'API 엔드포인트를 찾을 수 없습니다.' });
    } else {
        // 일반 페이지 요청인 경우 HTML 응답
        res.status(404).send('파일을 찾을 수 없습니다.');
    }
});

// 서버 시작
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 시그널링 서버가 포트 ${PORT}에서 시작되었습니다!`);
    console.log(`🌐 http://localhost:${PORT}`);
    console.log(`📡 WebSocket: ws://localhost:${PORT}`);
    console.log(`🔧 계정 시스템 및 랭킹 시스템 활성화됨`);
    console.log(`💾 영구 저장소 시스템 활성화됨`);
    
    // 데이터 로드
    loadData();

    // 라우터는 이미 등록됨
});

// 서버 종료 시 데이터 저장
process.on('SIGINT', async () => {
    console.log('\n🔄 서버 종료 중...');
    await saveDataImmediate();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🔄 서버 종료 중...');
    await saveDataImmediate();
    process.exit(0);
}); 