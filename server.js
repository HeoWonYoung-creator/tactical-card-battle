const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    // 연결 안정성 개선
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
});

// CORS 설정
app.use(cors());
app.use(express.json()); // JSON 파싱 추가

// 정적 파일 제공 개선
app.use(express.static(path.join(__dirname)));

// 메인 페이지 라우트
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'webrtc-multiplayer.html'));
});

// webrtc-multiplayer.html 직접 라우트
app.get('/webrtc-multiplayer.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'webrtc-multiplayer.html'));
});

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
const sessions = new Map(); // sessionId -> userId
let nextUserId = 1;

// 랭킹 시스템
const rankings = {
    mock: new Map(), // 모의 결투 랭킹 (username -> score)
    formal: new Map() // 정식 결투 랭킹 (username -> score)
};

// 파일 시스템을 사용한 영구 저장소
const fs = require('fs');

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
                
                // 기존 유저들을 랭킹에 등록 (없는 경우에만)
                for (const [userId, userData] of users) {
                    if (!rankings.mock.has(userData.nickname)) {
                        rankings.mock.set(userData.nickname, userData.trophies.mock || 0);
                    }
                    if (!rankings.formal.has(userData.nickname)) {
                        rankings.formal.set(userData.nickname, userData.trophies.formal || 0);
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
                for (const [sessionId, userId] of Object.entries(sessionsData)) {
                    sessions.set(sessionId, parseInt(userId));
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
function saveData() {
    try {
        // 유저 데이터 저장
        const usersData = {};
        for (const [userId, userData] of users) {
            usersData[userId] = userData;
        }
        fs.writeFileSync(USERS_FILE, JSON.stringify(usersData, null, 2));
        
        // 랭킹 데이터 저장
        const rankingsData = {
            mock: Array.from(rankings.mock.entries()),
            formal: Array.from(rankings.formal.entries())
        };
        fs.writeFileSync(RANKINGS_FILE, JSON.stringify(rankingsData, null, 2));
        
        // 세션 데이터 저장
        const sessionsData = {};
        for (const [sessionId, userId] of sessions) {
            sessionsData[sessionId] = userId;
        }
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessionsData, null, 2));
        
        console.log('💾 데이터 저장 완료');
    } catch (error) {
        console.error('❌ 데이터 저장 중 오류:', error);
    }
}

/**
 * 세션 ID 생성
 */
function generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * 계정 생성 API
 */
app.post('/api/register', async (req, res) => {
    try {
        const { username, password, nickname } = req.body;
        
        // 입력 검증
        if (!username || !password || !nickname) {
            return res.status(400).json({ error: '모든 필드를 입력해주세요.' });
        }
        
        if (username.length < 3 || username.length > 20) {
            return res.status(400).json({ error: '아이디는 3-20자 사이여야 합니다.' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다.' });
        }
        
        if (nickname.length < 2 || nickname.length > 15) {
            return res.status(400).json({ error: '닉네임은 2-15자 사이여야 합니다.' });
        }
        
        // 아이디 중복 확인
        if (usernames.has(username)) {
            return res.status(400).json({ error: '이미 사용 중인 아이디입니다.' });
        }
        
        // 닉네임 중복 확인
        for (const [_, userData] of users) {
            if (userData.nickname === nickname) {
                return res.status(400).json({ error: '이미 사용 중인 닉네임입니다.' });
            }
        }
        
        // 비밀번호 해시화
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // 유저 생성
        const userId = nextUserId++;
        const userData = {
            userId,
            username,
            nickname,
            password: hashedPassword,
            icon: '👤', // 기본 아이콘
            trophies: {
                mock: 0,
                formal: 0
            },
            lastNicknameChange: 0,
            createdAt: Date.now()
        };
        
        users.set(userId, userData);
        usernames.set(username, userId);
        
        // 랭킹에 0점으로 등록
        rankings.mock.set(nickname, 0);
        rankings.formal.set(nickname, 0);
        
        // 세션 생성
        const sessionId = generateSessionId();
        sessions.set(sessionId, userId);
        
        saveData();
        
        console.log(`👤 새 계정 생성: ${username} (${nickname})`);
        
        res.json({
            success: true,
            sessionId,
            userData: {
                userId,
                username,
                nickname,
                icon: userData.icon,
                trophies: userData.trophies
            }
        });
        
    } catch (error) {
        console.error('❌ 계정 생성 오류:', error);
        res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
});

/**
 * 로그인 API
 */
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // 입력 검증
        if (!username || !password) {
            return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요.' });
        }
        
        // 유저 찾기
        const userId = usernames.get(username);
        if (!userId) {
            return res.status(400).json({ error: '아이디 또는 비밀번호가 잘못되었습니다.' });
        }
        
        const userData = users.get(userId);
        if (!userData) {
            return res.status(400).json({ error: '아이디 또는 비밀번호가 잘못되었습니다.' });
        }
        
        // 비밀번호 확인
        const isValidPassword = await bcrypt.compare(password, userData.password);
        if (!isValidPassword) {
            return res.status(400).json({ error: '아이디 또는 비밀번호가 잘못되었습니다.' });
        }
        
        // 세션 생성
        const sessionId = generateSessionId();
        sessions.set(sessionId, userId);
        
        console.log(`🔐 로그인 성공: ${username}`);
        
        // 기존 유저 데이터에 icon 필드가 없으면 추가
        if (!userData.icon) {
            userData.icon = '👤';
            saveData();
        }
        
        res.json({
            success: true,
            sessionId,
            userData: {
                userId,
                username,
                nickname: userData.nickname,
                icon: userData.icon,
                trophies: userData.trophies
            }
        });
        
    } catch (error) {
        console.error('❌ 로그인 오류:', error);
        res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
});

/**
 * 세션 확인 API
 */
app.post('/api/verify-session', (req, res) => {
    try {
        const { sessionId } = req.body;
        
        if (!sessionId) {
            return res.status(400).json({ error: '세션 ID가 필요합니다.' });
        }
        
        const userId = sessions.get(sessionId);
        if (!userId) {
            return res.status(401).json({ error: '유효하지 않은 세션입니다.' });
        }
        
        const userData = users.get(userId);
        if (!userData) {
            return res.status(401).json({ error: '유저 데이터를 찾을 수 없습니다.' });
        }
        
        // 기존 유저 데이터에 icon 필드가 없으면 추가
        if (!userData.icon) {
            userData.icon = '👤';
            saveData();
        }
        
        res.json({
            success: true,
            userData: {
                userId,
                username: userData.username,
                nickname: userData.nickname,
                icon: userData.icon,
                trophies: userData.trophies
            }
        });
        
    } catch (error) {
        console.error('❌ 세션 확인 오류:', error);
        res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
});

/**
 * 닉네임 변경 API
 */
app.post('/api/change-nickname', (req, res) => {
    try {
        const { sessionId, newNickname } = req.body;
        
        if (!sessionId || !newNickname) {
            return res.status(400).json({ error: '세션 ID와 새 닉네임이 필요합니다.' });
        }
        
        const userId = sessions.get(sessionId);
        if (!userId) {
            return res.status(401).json({ error: '유효하지 않은 세션입니다.' });
        }
        
        const userData = users.get(userId);
        if (!userData) {
            return res.status(401).json({ error: '유저 데이터를 찾을 수 없습니다.' });
        }
        
        // 닉네임 길이 검증
        if (newNickname.length < 2 || newNickname.length > 15) {
            return res.status(400).json({ error: '닉네임은 2-15자 사이여야 합니다.' });
        }
        
        // 1시간 제한 확인
        const now = Date.now();
        const oneHour = 60 * 60 * 1000;
        if (userData.lastNicknameChange && (now - userData.lastNicknameChange) < oneHour) {
            const remainingTime = Math.ceil((oneHour - (now - userData.lastNicknameChange)) / (60 * 1000));
            return res.status(400).json({ 
                error: `닉네임 변경은 1시간에 1번만 가능합니다. ${remainingTime}분 후에 다시 시도해주세요.` 
            });
        }
        
        // 닉네임 중복 확인
        for (const [_, otherUserData] of users) {
            if (otherUserData.userId !== userId && otherUserData.nickname === newNickname) {
                return res.status(400).json({ error: '이미 사용 중인 닉네임입니다.' });
            }
        }
        
        // 기존 닉네임으로 랭킹 데이터 업데이트
        const oldNickname = userData.nickname;
        const mockScore = rankings.mock.get(oldNickname) || 0;
        const formalScore = rankings.formal.get(oldNickname) || 0;
        
        if (mockScore > 0) {
            rankings.mock.delete(oldNickname);
            rankings.mock.set(newNickname, mockScore);
        }
        if (formalScore > 0) {
            rankings.formal.delete(oldNickname);
            rankings.formal.set(newNickname, formalScore);
        }
        
        // 닉네임 변경
        userData.nickname = newNickname;
        userData.lastNicknameChange = now;
        
        saveData();
        
        console.log(`🔄 닉네임 변경: ${oldNickname} -> ${newNickname}`);
        
        res.json({
            success: true,
            userData: {
                userId,
                username: userData.username,
                nickname: userData.nickname,
                trophies: userData.trophies
            }
        });
        
    } catch (error) {
        console.error('❌ 닉네임 변경 오류:', error);
        res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
});

/**
 * 아이콘 변경 API
 */
app.post('/api/change-icon', (req, res) => {
    try {
        const { sessionId, icon } = req.body;
        
        console.log('🔍 아이콘 변경 요청:', { sessionId, icon });
        
        if (!sessionId || !icon) {
            console.log('❌ 필수 정보 누락:', { sessionId: !!sessionId, icon: !!icon });
            return res.status(400).json({ error: '필수 정보가 누락되었습니다.' });
        }
        
        const userId = sessions.get(sessionId);
        if (!userId) {
            return res.status(401).json({ error: '유효하지 않은 세션입니다.' });
        }
        
        const userData = users.get(userId);
        if (!userData) {
            return res.status(401).json({ error: '유저 데이터를 찾을 수 없습니다.' });
        }
        
        // 아이콘 유효성 검증 (빈 문자열이 아닌지만 확인)
        if (!icon || icon.trim() === '') {
            console.log('❌ 빈 아이콘:', icon);
            return res.status(400).json({ error: '아이콘을 선택해주세요.' });
        }
        
        // 아이콘 변경
        userData.icon = icon;
        
        saveData();
        
        console.log(`🔄 아이콘 변경: ${userData.nickname} -> ${icon}`);
        
        res.json({
            success: true,
            icon: icon
        });
        
    } catch (error) {
        console.error('❌ 아이콘 변경 오류:', error);
        res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
});

/**
 * 랭킹 조회 API
 */
app.get('/api/rankings/:category', (req, res) => {
    try {
        const { category } = req.params;
        
        if (!rankings[category]) {
            return res.status(400).json({ error: '유효하지 않은 카테고리입니다.' });
        }
        
        // 랭킹 데이터 생성
        const rankingData = [];
        for (const [nickname, score] of rankings[category]) {
            rankingData.push({ nickname, score });
        }
        
        // 점수 높은 순으로 정렬
        rankingData.sort((a, b) => b.score - a.score);
        
        console.log(`📊 랭킹 조회: ${category} - ${rankingData.length}명`);
        
        res.json({
            success: true,
            category,
            rankings: rankingData
        });
        
    } catch (error) {
        console.error('❌ 랭킹 조회 오류:', error);
        res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
});

/**
 * 승리의 증표 업데이트 API
 */
app.post('/api/update-trophies', (req, res) => {
    try {
        const { sessionId, category, change } = req.body;
        
        if (!sessionId || !category || change === undefined) {
            return res.status(400).json({ error: '필수 정보가 누락되었습니다.' });
        }
        
        const userId = sessions.get(sessionId);
        if (!userId) {
            return res.status(401).json({ error: '유효하지 않은 세션입니다.' });
        }
        
        const userData = users.get(userId);
        if (!userData) {
            return res.status(401).json({ error: '유저 데이터를 찾을 수 없습니다.' });
        }
        
        // 증표 업데이트
        const oldScore = userData.trophies[category] || 0;
        const newScore = Math.max(0, oldScore + change);
        userData.trophies[category] = newScore;
        
        // 랭킹 업데이트
        rankings[category].set(userData.nickname, newScore);
        
        saveData();
        
        console.log(`🏆 증표 업데이트: ${userData.nickname} ${category} ${oldScore} -> ${newScore} (${change > 0 ? '+' : ''}${change})`);
        
        res.json({
            success: true,
            trophies: userData.trophies
        });
        
    } catch (error) {
        console.error('❌ 증표 업데이트 오류:', error);
        res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
});

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
    socket.emit('error', {
        message: '서버 오류가 발생했습니다.',
        context: context
    });
}

// 연결 상태 확인 함수
function isPlayerConnected(playerId) {
    return io.sockets.sockets.has(playerId);
}

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
            
            const userId = sessions.get(sessionId);
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
            const playerName = data.playerName || '게스트';
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
            if (isPlayerConnected(target)) {
                io.to(target).emit('offer', {
                    from: socket.id,
                    offer: offer
                });
            } else {
                socket.emit('error', {
                    message: '상대방이 연결되지 않았습니다.',
                    context: 'offer'
                });
            }
        } catch (error) {
            handleError(socket, error, 'offer');
        }
    });
    
    socket.on('answer', (data) => {
        try {
            const { target, answer } = data;
            
            if (isPlayerConnected(target)) {
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
            
            if (isPlayerConnected(target)) {
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
            
            if (isPlayerConnected(target)) {
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
            
            if (isPlayerConnected(target)) {
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
            
            if (isPlayerConnected(target)) {
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
            
            if (isPlayerConnected(target)) {
                // 게임 상태 업데이트
                if (gameState && playerInfo.gameId) {
                    gameStates.set(playerInfo.gameId, gameState);
                }
                
                io.to(target).emit('gameOver', {
                    from: socket.id,
                    winner: winner,
                    gameState: gameState,
                    isGuest: isGuest
                });
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
                    }
                    
                    activeGames.delete(playerInfo.gameId);
                    gameStates.delete(playerInfo.gameId);
                    serverStats.activeGames = Math.max(0, serverStats.activeGames - 1);
                    console.log(`❌ 게임 세션 종료: ${playerInfo.gameId}`);
                }
            }
            
            // 플레이어 세션 제거
            playerSessions.delete(socket.id);
            serverStats.totalConnections = Math.max(0, serverStats.totalConnections - 1);
            
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
}, 30000);

// 서버 상태 모니터링
setInterval(() => {
    console.log(`📊 서버 상태: 연결 ${serverStats.totalConnections}, 게임 ${serverStats.activeGames}, 대기 ${serverStats.waitingPlayers}, 총 매칭 ${serverStats.totalMatches}`);
}, 30000);

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
});

// 서버 종료 시 데이터 저장
process.on('SIGINT', () => {
    console.log('\n🔄 서버 종료 중...');
    saveData();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🔄 서버 종료 중...');
    saveData();
    process.exit(0);
}); 