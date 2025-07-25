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

// 랭킹 시스템
const rankings = {
    mock: new Map(), // 모의 결투장 랭킹
    formal: new Map(), // 정식 마법사 랭킹
    daily: new Map() // 오늘의 마법왕 랭킹 (12시 기준 리셋)
};

// 오늘의 마법왕 리셋 시간 (매일 12시)
let lastDailyReset = new Date();
lastDailyReset.setHours(12, 0, 0, 0);
if (lastDailyReset > new Date()) {
    lastDailyReset.setDate(lastDailyReset.getDate() - 1);
}

// 오늘의 마법왕 리셋 체크 함수
function checkDailyReset() {
    const now = new Date();
    const today12PM = new Date();
    today12PM.setHours(12, 0, 0, 0);
    
    // 오늘 12시가 지났고, 마지막 리셋이 오늘 12시 이전이면 리셋
    if (now >= today12PM && lastDailyReset < today12PM) {
        console.log('🔄 오늘의 마법왕 랭킹 리셋 실행');
        rankings.daily.clear();
        lastDailyReset = now;
        console.log('✅ 오늘의 마법왕 랭킹이 리셋되었습니다.');
    }
}

// 랭킹 업데이트 함수 (증표 기반)
function updateRanking(category, playerName, stats) {
    // 오늘의 마법왕 리셋 체크
    if (category === 'daily') {
        checkDailyReset();
    }
    
    // 기존에 같은 이름의 기록이 있는지 확인
    let existingPlayer = null;
    for (const [existingName, playerData] of rankings[category]) {
        if (existingName === playerName) {
            existingPlayer = playerData;
            break;
        }
    }
    
    if (existingPlayer) {
        // 기존 기록 업데이트 (증표 기반)
        existingPlayer.trophies = stats.trophies || 0;
        existingPlayer.wins = stats.wins;
        existingPlayer.losses = stats.losses;
        existingPlayer.winStreak = stats.currentWinStreak || 0;
        existingPlayer.maxWinStreak = stats.maxWinStreak || 0;
        existingPlayer.lastUpdated = Date.now();
        
        console.log(`📊 랭킹 업데이트: ${category} - ${playerName} (기존 기록 업데이트, 증표: ${stats.trophies}, 승리: ${stats.wins})`);
    } else {
        // 새로운 기록 생성 (증표 기반)
        rankings[category].set(playerName, {
            name: playerName,
            trophies: stats.trophies || 0,
            wins: stats.wins,
            losses: stats.losses,
            winStreak: stats.currentWinStreak || 0,
            maxWinStreak: stats.maxWinStreak || 0,
            lastUpdated: Date.now()
        });
        
        console.log(`📊 랭킹 업데이트: ${category} - ${playerName} (새 기록 생성, 증표: ${stats.trophies}, 승리: ${stats.wins})`);
    }
    
    // 랭킹 정렬 및 로깅
    const sortedRanking = getSortedRanking(category);
    console.log(`📊 랭킹 정렬 시작: ${category} - ${rankings[category].size}명`);
    
    const top3 = sortedRanking.slice(0, 3);
    const top3Names = top3.map(player => player.name).join(', ');
    console.log(`📊 랭킹 정렬 완료: ${category} - 상위 3명: ${top3Names}`);
    
    console.log(`📊 업데이트 후 랭킹 상태: ${category} - ${rankings[category].size}명`);
    const top3Trophies = top3.map(player => `${player.name}(${player.trophies}증표)`).join(', ');
    console.log(`📊 상위 3명: ${top3Trophies}`);
}

// 랭킹 정렬 함수 (승리의 증표 기준)
function getSortedRanking(category) {
    try {
        const players = Array.from(rankings[category].values());
        console.log(`📊 랭킹 정렬 시작: ${category} - ${players.length}명`);
        
        if (players.length === 0) {
            console.log(`📊 랭킹 데이터 없음: ${category}`);
            return [];
        }
        
        // 승리의 증표 기준으로 정렬 (서버에 저장된 trophies 값 사용)
        const sortedPlayers = players.sort((a, b) => {
            const aTrophies = a.trophies || 0;
            const bTrophies = b.trophies || 0;
            
            if (bTrophies !== aTrophies) {
                return bTrophies - aTrophies;
            }
            if (b.wins !== a.wins) {
                return b.wins - a.wins;
            }
            return (b.maxWinStreak || 0) - (a.maxWinStreak || 0);
        });
        
        console.log(`📊 랭킹 정렬 완료: ${category} - 상위 3명: ${sortedPlayers.slice(0, 3).map(p => p.name).join(', ')}`);
        return sortedPlayers;
    } catch (error) {
        console.error(`❌ 랭킹 정렬 오류 (${category}):`, error);
        return [];
    }
}

// 중복 이름 정리 함수
function cleanupDuplicateNames(category) {
    const nameCounts = new Map();
    const toRemove = [];
    
    // 각 이름의 등장 횟수 확인
    for (const [name, data] of rankings[category]) {
        if (nameCounts.has(name)) {
            nameCounts.set(name, nameCounts.get(name) + 1);
            toRemove.push(name);
        } else {
            nameCounts.set(name, 1);
        }
    }
    
    // 중복된 이름들 제거 (가장 최근 업데이트된 것만 유지)
    for (const name of toRemove) {
        let latestEntry = null;
        let latestUpdateTime = 0;
        
        for (const [entryName, data] of rankings[category]) {
            if (entryName === name && data.lastUpdated > latestUpdateTime) {
                latestUpdateTime = data.lastUpdated;
                latestEntry = { name: entryName, data: data };
            }
        }
        
        // 최신 기록을 제외한 모든 중복 제거
        for (const [entryName, data] of rankings[category]) {
            if (entryName === name && data.lastUpdated !== latestUpdateTime) {
                rankings[category].delete(entryName);
                console.log(`🧹 중복 이름 정리: ${category} - ${entryName} 제거`);
            }
        }
    }
}

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
            const { category, playerName, stats } = data;
            console.log(`📊 랭킹 업데이트 요청: ${category} - ${playerName}`, stats);
            updateRanking(category, playerName, stats);
            
            // 업데이트 후 랭킹 상태 로깅
            const ranking = getSortedRanking(category);
            console.log(`📊 업데이트 후 랭킹 상태: ${category} - ${ranking.length}명`);
            if (ranking.length > 0) {
                console.log(`📊 상위 3명: ${ranking.slice(0, 3).map(p => `${p.name}(${p.trophies}증표)`).join(', ')}`);
            }
        } catch (error) {
            handleError(socket, error, 'updateRanking');
        }
    });
    
    // 랭킹 조회
    socket.on('getRanking', (data) => {
        try {
            const { category } = data;
            
            console.log(`📊 랭킹 조회 요청: ${category} (${socket.id})`);
            
            // 카테고리 유효성 검사
            if (!rankings[category]) {
                console.log(`❌ 잘못된 랭킹 카테고리: ${category}`);
                socket.emit('rankingData', {
                    category: category,
                    ranking: [],
                    error: '잘못된 카테고리입니다.'
                });
                return;
            }
            
            // 중복 이름 정리
            cleanupDuplicateNames(category);
            
            const ranking = getSortedRanking(category);
            console.log(`📊 랭킹 데이터 전송: ${category} - ${ranking.length}명`);
            
            // 랭킹 데이터에 증표 정보 포함
            const rankingWithTrophies = ranking.map(player => ({
                ...player,
                trophies: player.trophies || 0
            }));
            
            // 상위 5명의 증표 정보 로깅
            if (rankingWithTrophies.length > 0) {
                console.log(`📊 ${category} 상위 5명 증표 정보:`);
                rankingWithTrophies.slice(0, 5).forEach((player, index) => {
                    console.log(`  ${index + 1}. ${player.name}: ${player.trophies}증표 (${player.wins}승 ${player.losses}패, 최고${player.maxWinStreak}연승)`);
                });
            }
            
            socket.emit('rankingData', {
                category: category,
                ranking: rankingWithTrophies
            });
        } catch (error) {
            console.error(`❌ 랭킹 조회 오류 (${data.category}):`, error);
            handleError(socket, error, 'getRanking');
            
            // 에러 발생 시 빈 랭킹 반환
            socket.emit('rankingData', {
                category: data.category,
                ranking: [],
                error: '랭킹 데이터를 불러오는 중 오류가 발생했습니다.'
            });
        }
    });

    // 치트: 모든 서버 데이터 초기화
    socket.on('resetAllServerData', () => {
        try {
            console.log(`🧹 치트: 모든 서버 데이터 초기화 요청 (${socket.id})`);
            
            // 모든 랭킹 데이터 초기화
            rankings.mock.clear();
            rankings.formal.clear();
            rankings.daily.clear();
            
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
            
            // AI 랭킹에서 해당 플레이어 제거
            for (const [name, data] of rankings.ai) {
                if (name === playerName) {
                    rankings.ai.delete(name);
                    console.log(`🗑️ AI 랭킹에서 제거: ${playerName}`);
                }
            }
            
            // 멀티플레이어 랭킹에서 해당 플레이어 제거
            for (const [name, data] of rankings.multiplayer) {
                if (name === playerName) {
                    rankings.multiplayer.delete(name);
                    console.log(`🗑️ 멀티플레이어 랭킹에서 제거: ${playerName}`);
                }
            }
            
            // 오늘의 마법왕 랭킹에서 해당 플레이어 제거
            for (const [name, data] of rankings.daily) {
                if (name === playerName) {
                    rankings.daily.delete(name);
                    console.log(`🗑️ 오늘의 마법왕 랭킹에서 제거: ${playerName}`);
                }
            }
            
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
    
    // 중복 이름 정리 (5분마다)
    cleanupDuplicateNames('ai');
    cleanupDuplicateNames('multiplayer');
    cleanupDuplicateNames('daily');
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
}); 