function getGameIdOf(playerSessions, socketId) {
  const info = playerSessions.get(socketId);
  return info ? info.gameId : null;
}

function getOpponentSocketId(activeGames, gameId, socketId) {
  const gameSession = activeGames.get(gameId);
  if (!gameSession) return null;
  const opponent = gameSession.players.find(p => p.id !== socketId);
  return opponent ? opponent.id : null;
}

function arePlayersInSameGame(playerSessions, activeGames, aSocketId, bSocketId) {
  const aGame = getGameIdOf(playerSessions, aSocketId);
  if (!aGame) return false;
  const bGame = getGameIdOf(playerSessions, bSocketId);
  if (!bGame) return false;
  return aGame === bGame && !!activeGames.get(aGame);
}

module.exports = { getGameIdOf, getOpponentSocketId, arePlayersInSameGame };


