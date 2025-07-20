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
    }
});

// CORS 설정
app.use(cors());
app.use(express.static(path.join(__dirname)));

// 게임 상태 관리
const waitingPlayers = new Map(); // 대기 중인 플레이어들
const activeGames = new Map(); // 활성 게임들
const playerSessions = new Map(); // 플레이어 세션 관리

// 서버 상태
let serverStats = {
    totalConnections: 0,
    activeGames: 0,
    waitingPlayers: 0
};

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
        opponent: null
    };
    
    playerSessions.set(socket.id, playerInfo);
    
    // 서버 상태 전송
    socket.emit('serverStats', serverStats);
    
    // 매칭 요청
    socket.on('requestMatch', (data) => {
        const playerName = data.playerName || 'Player';
        playerInfo.name = playerName;
        playerInfo.isWaiting = true;
        
        console.log(`🎯 매칭 요청: ${playerName} (${socket.id})`);
        
        // 대기 중인 다른 플레이어 찾기
        let matchedPlayer = null;
        for (const [waitingId, waitingPlayer] of waitingPlayers) {
            if (waitingId !== socket.id) {
                matchedPlayer = waitingPlayer;
                break;
            }
        }
        
        if (matchedPlayer) {
            // 매칭 성공!
            console.log(`✅ 매칭 성공: ${playerName} ↔ ${matchedPlayer.name}`);
            
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
                createdAt: Date.now()
            };
            
            activeGames.set(gameId, gameSession);
            playerInfo.gameId = gameId;
            playerInfo.opponent = matchedPlayer.id;
            
            const matchedPlayerInfo = playerSessions.get(matchedPlayer.id);
            matchedPlayerInfo.gameId = gameId;
            matchedPlayerInfo.opponent = socket.id;
            
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
    });
    
    // WebRTC 시그널링
    socket.on('offer', (data) => {
        const { target, offer } = data;
        console.log(`📤 Offer 전송: ${socket.id} → ${target}`);
        io.to(target).emit('offer', {
            from: socket.id,
            offer: offer
        });
    });
    
    socket.on('answer', (data) => {
        const { target, answer } = data;
        console.log(`📤 Answer 전송: ${socket.id} → ${target}`);
        io.to(target).emit('answer', {
            from: socket.id,
            answer: answer
        });
    });
    
    socket.on('iceCandidate', (data) => {
        const { target, candidate } = data;
        io.to(target).emit('iceCandidate', {
            from: socket.id,
            candidate: candidate
        });
    });
    
    // 게임 상태 동기화
    socket.on('gameState', (data) => {
        const { target, gameState } = data;
        io.to(target).emit('gameState', {
            from: socket.id,
            gameState: gameState
        });
    });
    
    // 카드 플레이
    socket.on('cardPlayed', (data) => {
        const { target, card, playerId } = data;
        io.to(target).emit('cardPlayed', {
            from: socket.id,
            card: card,
            playerId: playerId
        });
    });
    
    // 턴 종료
    socket.on('turnEnd', (data) => {
        const { target } = data;
        io.to(target).emit('turnEnd', {
            from: socket.id
        });
    });
    
    // 게임 종료
    socket.on('gameOver', (data) => {
        const { target, winner } = data;
        io.to(target).emit('gameOver', {
            from: socket.id,
            winner: winner
        });
    });
    
    // 연결 해제 처리
    socket.on('disconnect', () => {
        console.log(`🔌 연결 해제: ${socket.id}`);
        
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
                const opponent = gameSession.players.find(p => p.id !== socket.id);
                if (opponent) {
                    io.to(opponent.id).emit('opponentDisconnected', {
                        message: '상대방이 연결을 해제했습니다.'
                    });
                }
                
                activeGames.delete(playerInfo.gameId);
                serverStats.activeGames = Math.max(0, serverStats.activeGames - 1);
                console.log(`❌ 게임 세션 종료: ${playerInfo.gameId}`);
            }
        }
        
        // 플레이어 세션 제거
        playerSessions.delete(socket.id);
        serverStats.totalConnections = Math.max(0, serverStats.totalConnections - 1);
        
        // 서버 상태 업데이트
        io.emit('serverStats', serverStats);
    });
});

// 서버 상태 모니터링
setInterval(() => {
    console.log(`📊 서버 상태: 연결 ${serverStats.totalConnections}, 게임 ${serverStats.activeGames}, 대기 ${serverStats.waitingPlayers}`);
}, 30000);

// 서버 시작
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 시그널링 서버가 포트 ${PORT}에서 시작되었습니다!`);
    console.log(`🌐 http://localhost:${PORT}`);
    console.log(`📡 WebSocket: ws://localhost:${PORT}`);
}); 