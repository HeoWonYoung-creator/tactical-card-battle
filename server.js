const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

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

// 404 에러 처리
app.use((req, res) => {
    console.log(`404 에러: ${req.method} ${req.url}`);
    res.status(404).send('파일을 찾을 수 없습니다.');
});

// 게임 상태 관리
const waitingPlayers = new Map(); // 대기 중인 플레이어들
const activeGames = new Map(); // 활성 게임들
const playerSessions = new Map(); // 플레이어 세션 관리
const gameStates = new Map(); // 게임 상태 저장

// 랭킹 시스템 (점수와 아이콘 정보 저장)
const rankings = {
    mock: new Map(), // 모의 결투 점수
    formal: new Map() // 정식 결투 점수
};

// 플레이어 아이콘 정보 저장
const playerIcons = new Map(); // 플레이어 이름 -> 아이콘 매핑

// 유저 ID 시스템
const userIds = new Map(); // 플레이어 이름 -> 유저 ID 매핑
const userNames = new Map(); // 유저 ID -> 플레이어 이름 매핑
let nextUserId = 1; // 다음 유저 ID

// 파일 시스템을 사용한 영구 저장소
const fs = require('fs');

// 데이터 파일 경로
const DATA_DIR = path.join(__dirname, 'data');
const RANKINGS_FILE = path.join(DATA_DIR, 'rankings.json');
const USER_IDS_FILE = path.join(DATA_DIR, 'userIds.json');
const PLAYER_ICONS_FILE = path.join(DATA_DIR, 'playerIcons.json');

// 데이터 디렉토리 생성
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('📁 데이터 디렉토리 생성됨');
}

// 데이터 로드 함수
function loadData() {
    try {
        console.log('📁 데이터 파일 확인 중...');
        console.log(`📁 RANKINGS_FILE 존재: ${fs.existsSync(RANKINGS_FILE)}`);
        console.log(`📁 USER_IDS_FILE 존재: ${fs.existsSync(USER_IDS_FILE)}`);
        console.log(`📁 PLAYER_ICONS_FILE 존재: ${fs.existsSync(PLAYER_ICONS_FILE)}`);
        
        // 랭킹 데이터 로드
        if (fs.existsSync(RANKINGS_FILE)) {
            const rankingsData = JSON.parse(fs.readFileSync(RANKINGS_FILE, 'utf8'));
            rankings.mock = new Map(rankingsData.mock || []);
            rankings.formal = new Map(rankingsData.formal || []);
            console.log(`📊 랭킹 데이터 로드됨: 모의 ${rankings.mock.size}명, 정식 ${rankings.formal.size}명`);
        } else {
            console.log(`📁 RANKINGS_FILE이 존재하지 않습니다.`);
        }
        
        // 유저 ID 데이터 로드
        if (fs.existsSync(USER_IDS_FILE)) {
            const userIdsData = JSON.parse(fs.readFileSync(USER_IDS_FILE, 'utf8'));
            userIds.clear();
            userNames.clear();
            
            for (const [name, id] of userIdsData.userIds || []) {
                userIds.set(name, id);
                userNames.set(id, name);
            }
            nextUserId = userIdsData.nextUserId || 1;
            console.log(`🆔 유저 ID 데이터 로드됨: ${userIds.size}명, 다음 ID: ${nextUserId}`);
        } else {
            console.log(`📁 USER_IDS_FILE이 존재하지 않습니다.`);
        }
        
        // 플레이어 아이콘 데이터 로드
        if (fs.existsSync(PLAYER_ICONS_FILE)) {
            const iconsData = JSON.parse(fs.readFileSync(PLAYER_ICONS_FILE, 'utf8'));
            playerIcons.clear();
            for (const [name, icon] of iconsData || []) {
                playerIcons.set(name, icon);
            }
            console.log(`🎭 플레이어 아이콘 데이터 로드됨: ${playerIcons.size}명`);
        } else {
            console.log(`📁 PLAYER_ICONS_FILE이 존재하지 않습니다.`);
        }
    } catch (error) {
        console.error('❌ 데이터 로드 중 오류:', error);
    }
}

// 데이터 저장 함수
function saveData() {
    try {
        // 랭킹 데이터 저장
        const rankingsData = {
            mock: Array.from(rankings.mock.entries()),
            formal: Array.from(rankings.formal.entries())
        };
        fs.writeFileSync(RANKINGS_FILE, JSON.stringify(rankingsData, null, 2));
        
        // 유저 ID 데이터 저장
        const userIdsData = {
            userIds: Array.from(userIds.entries()),
            nextUserId: nextUserId
        };
        fs.writeFileSync(USER_IDS_FILE, JSON.stringify(userIdsData, null, 2));
        
        // 플레이어 아이콘 데이터 저장
        const iconsData = Array.from(playerIcons.entries());
        fs.writeFileSync(PLAYER_ICONS_FILE, JSON.stringify(iconsData, null, 2));
        
        console.log('💾 데이터 저장 완료');
    } catch (error) {
        console.error('❌ 데이터 저장 중 오류:', error);
    }
}

// 서버 시작 시 데이터 로드
console.log('🚀 서버 시작 - 데이터 로드 시작');
loadData();

// 서버 시작 시 모든 등록된 사용자 정보 출력
console.log(`🚀 서버 시작 완료 - 등록된 총 사용자: ${userIds.size}명`);
if (userIds.size > 0) {
    console.log(`📊 등록된 사용자 목록: ${Array.from(userIds.keys()).join(', ')}`);
} else {
    console.log(`⚠️ 등록된 사용자가 없습니다. - 게임을 플레이하면 사용자가 등록됩니다.`);
}



// 유저 ID 관리 함수
function getOrCreateUserId(playerName) {
    // 이미 존재하는 유저인지 확인
    if (userIds.has(playerName)) {
        return userIds.get(playerName);
        }
    
    // 새로운 유저 ID 발급
    const userId = nextUserId++;
    userIds.set(playerName, userId);
    userNames.set(userId, playerName);
        
    console.log(`🆔 새로운 유저 ID 발급: ${playerName} -> ID ${userId}`);
    return userId;
}

// 유저 이름 업데이트 함수
function updateUserName(oldName, newName, icon) {
    if (userIds.has(oldName)) {
        const userId = userIds.get(oldName);
        
        // 기존 이름 제거
        userIds.delete(oldName);
        
        // 새 이름으로 업데이트
        userIds.set(newName, userId);
        userNames.set(userId, newName);
        
        // 랭킹 데이터도 새 이름으로 업데이트
        const mockScore = rankings.mock.get(oldName) || 0;
        const formalScore = rankings.formal.get(oldName) || 0;
        
        if (mockScore > 0 || formalScore > 0) {
            rankings.mock.delete(oldName);
            rankings.formal.delete(oldName);
            rankings.mock.set(newName, mockScore);
            rankings.formal.set(newName, formalScore);
        }
        
        // 아이콘 정보 업데이트
        playerIcons.delete(oldName);
        playerIcons.set(newName, icon);
        
        // 데이터를 파일에 저장
        saveData();
        
        console.log(`🔄 유저 이름 업데이트: ${oldName} -> ${newName} (ID: ${userId})`);
    }
}
        
// 랭킹 업데이트 함수
function updateRanking(category, playerName, score, icon = '👤') {
    // 유저 ID 확인/생성
    const userId = getOrCreateUserId(playerName);
    
    // 0점이어도 플레이어를 랭킹에 포함시킴
    rankings[category].set(playerName, score);
    
    // 아이콘 정보 저장
    playerIcons.set(playerName, icon);
    
    // 데이터를 파일에 저장
    saveData();
    
    console.log(`📊 랭킹 업데이트: ${category} - ${playerName} (ID: ${userId}, ${score}점, 아이콘: ${icon})`);
    console.log(`📊 현재 등록된 총 사용자: ${userIds.size}명`);
    console.log(`📊 등록된 사용자 목록: ${Array.from(userIds.keys()).join(', ')}`);
}

// 랭킹 조회 함수
function getRanking(category) {
    console.log(`📊 랭킹 조회 시작: ${category} - 등록된 총 사용자: ${userIds.size}명`);
    
    // 모든 등록된 사용자 가져오기
    const allUsers = new Set();
    
    // userIds에서 모든 사용자 추가 (우선순위)
    for (const [playerName, userId] of userIds.entries()) {
        allUsers.add(playerName);
        console.log(`👤 등록된 사용자 추가: ${playerName} (ID: ${userId})`);
    }
    
    // rankings에서 모든 사용자 추가 (userIds에 없는 경우도 포함)
    for (const [playerName, score] of rankings[category].entries()) {
        allUsers.add(playerName);
        console.log(`📊 랭킹에 있는 사용자 추가: ${playerName} (${score}점)`);
    }
    
    // 모든 사용자의 랭킹 데이터 생성
    const allPlayers = [];
    for (const playerName of allUsers) {
        const score = rankings[category].get(playerName) || 0; // 랭킹에 없으면 0점
        const icon = playerIcons.get(playerName) || '👤';
        allPlayers.push([playerName, score, icon]);
        console.log(`📊 최종 사용자: ${playerName} (${score}점, 아이콘: ${icon})`);
    }
    
    // 점수 높은 순으로 정렬
    const sortedPlayers = allPlayers.sort((a, b) => b[1] - a[1]);
    
    console.log(`📊 랭킹 조회 완료: ${category} - 총 ${sortedPlayers.length}명 표시`);
    if (sortedPlayers.length > 0) {
        console.log(`📊 랭킹 상위 5명: ${sortedPlayers.slice(0, 5).map(p => `${p[0]}(${p[1]}점)`).join(', ')}`);
    } else {
        console.log(`⚠️ 표시할 사용자가 없습니다.`);
    }
    
    return sortedPlayers;
}
        
// 랭킹 정렬 함수 제거됨

// 중복 이름 정리 함수 제거됨

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
        connectionAttempts: 0
    };
    
    playerSessions.set(socket.id, playerInfo);
    
    // 서버 상태 전송
    socket.emit('serverStats', serverStats);
    
    // 핑/퐁으로 연결 상태 확인
    socket.on('ping', () => {
        playerInfo.lastPing = Date.now();
        socket.emit('pong');
    });
    
    // 매칭 요청
    socket.on('requestMatch', (data) => {
        try {
            const playerName = data.playerName || 'Player';
            playerInfo.name = playerName;
            playerInfo.isWaiting = true;
            
            console.log(`🎯 매칭 요청: ${playerName} (${socket.id})`);
            
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
                        { id: socket.id, name: playerName, isHost: true },
                        { id: matchedPlayer.id, name: matchedPlayer.name, isHost: false }
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
                        name: matchedPlayer.name
                    },
                    isHost: true
                });
                
                io.to(matchedPlayer.id).emit('matchFound', {
                    gameId: gameId,
                    opponent: {
                        id: socket.id,
                        name: playerName
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
            const { target, winner, gameState } = data;
            
            if (isPlayerConnected(target)) {
                // 게임 상태 업데이트
                if (gameState && playerInfo.gameId) {
                    gameStates.set(playerInfo.gameId, gameState);
                }
                
                io.to(target).emit('gameOver', {
                    from: socket.id,
                    winner: winner,
                    gameState: gameState
                });
            }
        } catch (error) {
            handleError(socket, error, 'gameOver');
        }
    });
    
    // 랭킹 업데이트
    socket.on('updateRanking', (data) => {
        try {
            const { category, playerName, score, icon } = data;
            updateRanking(category, playerName, score, icon);
        } catch (error) {
            handleError(socket, error, 'updateRanking');
        }
    });
    
    // 유저 이름 업데이트
    socket.on('updateUserName', (data) => {
        try {
            const { oldName, newName, icon } = data;
            updateUserName(oldName, newName, icon);
        } catch (error) {
            handleError(socket, error, 'updateUserName');
        }
    });
    
    // 랭킹 조회
    socket.on('getRanking', (data) => {
        try {
            const { category } = data;
            console.log(`📊 랭킹 조회 요청 수신: ${category} (소켓 ID: ${socket.id})`);
            console.log(`📊 등록된 총 사용자: ${userIds.size}명`);
            console.log(`📊 rankings 상태: mock=${rankings.mock.size}명, formal=${rankings.formal.size}명`);
            
            // 등록된 사용자 목록 출력
            if (userIds.size > 0) {
                console.log(`📊 등록된 사용자 목록: ${Array.from(userIds.keys()).join(', ')}`);
            } else {
                console.log(`⚠️ 등록된 사용자가 없습니다.`);
            }
            
            // rankings에 있는 모든 사용자 목록 출력
            if (rankings[category].size > 0) {
                console.log(`📊 ${category} 랭킹에 있는 사용자 목록: ${Array.from(rankings[category].keys()).join(', ')}`);
            } else {
                console.log(`⚠️ ${category} 랭킹에 사용자가 없습니다.`);
            }
            
            const ranking = getRanking(category);
            console.log(`📊 랭킹 조회 완료: ${category} - ${ranking.length}명의 데이터 반환`);
            
            // 응답 데이터 로그 (상위 5개만)
            if (ranking.length > 0) {
                console.log(`📊 ${category} 랭킹 상위 5명:`, ranking.slice(0, 5).map(p => `${p[0]}(${p[1]}점)`));
            }
            
            socket.emit('rankingData', {
                category: category,
                ranking: ranking
            });
        } catch (error) {
            console.error(`❌ 랭킹 조회 중 오류:`, error);
            handleError(socket, error, 'getRanking');
        }
    });

    // 치트: 모든 서버 데이터 초기화
    socket.on('resetAllServerData', () => {
        try {
            console.log(`🧹 치트: 모든 서버 데이터 초기화 요청 (${socket.id})`);
            
            // 모든 게임 세션 초기화
            activeGames.clear();
            gameStates.clear();
            waitingPlayers.clear();
            
            // 서버 통계 초기화
            serverStats = {
                totalConnections: serverStats.totalConnections,
                activeGames: 0,
                waitingPlayers: 0,
                totalMatches: 0
            };
            
            // 모든 클라이언트에게 초기화 완료 알림
            io.emit('serverDataReset', {
                message: '모든 서버 데이터가 초기화되었습니다.',
                timestamp: Date.now()
            });
            
            console.log(`✅ 모든 서버 데이터 초기화 완료`);
        } catch (error) {
            handleError(socket, error, 'resetAllServerData');
        }
    });

    // 치트: 자신의 데이터만 초기화
    socket.on('resetMyData', (data) => {
        try {
            const { playerName } = data;
            console.log(`🧹 치트: 개인 데이터 초기화 요청 (${socket.id}) - ${playerName}`);
            
            // 요청한 클라이언트에게만 초기화 완료 알림
            socket.emit('myDataReset', {
                message: '개인 데이터가 초기화되었습니다.',
                playerName: playerName,
                timestamp: Date.now()
            });
            
            console.log(`✅ 개인 데이터 초기화 완료: ${playerName}`);
        } catch (error) {
            handleError(socket, error, 'resetMyData');
        }
    });
    
    // 게임 상태 복구 요청
    socket.on('requestGameState', (data) => {
        try {
            if (playerInfo.gameId) {
                const savedGameState = gameStates.get(playerInfo.gameId);
                if (savedGameState) {
                    socket.emit('gameStateRecovery', {
                        gameState: savedGameState
                    });
                }
            }
        } catch (error) {
            handleError(socket, error, 'requestGameState');
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
                        
                        // 강제종료한 플레이어를 도망으로 인한 패배로 기록
                        if (disconnectedPlayer) {
                            console.log(`🏃 강제종료한 플레이어 ${disconnectedPlayer.name}을(를) 도망으로 인한 패배로 기록`);
                            // 강제종료한 플레이어의 패배 기록 (나중에 랭킹 업데이트 시 사용)
                            const disconnectedPlayerInfo = playerSessions.get(socket.id);
                            if (disconnectedPlayerInfo) {
                                disconnectedPlayerInfo.disconnectedAsLoser = true;
                                disconnectedPlayerInfo.disconnectedGameId = playerInfo.gameId;
                            }
                        }
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
    
    // 중복 이름 정리 제거됨
}, 30000);

// 서버 상태 모니터링
setInterval(() => {
    console.log(`📊 서버 상태: 연결 ${serverStats.totalConnections}, 게임 ${serverStats.activeGames}, 대기 ${serverStats.waitingPlayers}, 총 매칭 ${serverStats.totalMatches}`);
}, 30000);

// 서버 시작
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 시그널링 서버가 포트 ${PORT}에서 시작되었습니다!`);
    console.log(`🌐 http://localhost:${PORT}`);
    console.log(`📡 WebSocket: ws://localhost:${PORT}`);
    console.log(`🔧 개선된 에러 핸들링 및 연결 안정성 적용됨`);
    console.log(`💾 영구 저장소 시스템 활성화됨`);
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