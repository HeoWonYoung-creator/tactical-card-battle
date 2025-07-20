# 🌐 다른 곳 친구와 게임하기 - 배포 가이드

## 현재 상황
- ✅ 시그널링 서버: 로컬에서 실행 중 (포트 3000)
- ✅ 멀티플레이어 게임: 정상 작동
- ❌ 인터넷 접근: 불가능

## 해결 방법들

### 1. 무료 클라우드 서비스 사용 (추천)

#### A. Render.com 사용
```bash
# 1. GitHub에 코드 업로드
# 2. Render.com에서 새 Web Service 생성
# 3. GitHub 저장소 연결
# 4. 자동 배포 완료
```

#### B. Railway.app 사용
```bash
# 1. railway.app 가입
# 2. GitHub 저장소 연결
# 3. 자동 배포
```

#### C. Heroku 사용
```bash
# 1. Heroku CLI 설치
# 2. heroku create
# 3. git push heroku main
```

### 2. ngrok 터널 (임시 해결책)
```bash
# 1. ngrok 계정 생성 (무료)
# 2. ngrok authtoken YOUR_TOKEN
# 3. ngrok http 3000
# 4. 제공된 URL 공유
```

### 3. VPS 서버 (고급)
- AWS, Google Cloud, DigitalOcean 등
- 서버에 Node.js 설치
- 코드 업로드 및 실행

## 배포 후 공유 방법
1. **클라우드 URL**: `https://your-app.render.com/webrtc-multiplayer.html`
2. **친구에게 공유**: URL만 전송하면 됨
3. **실시간 게임**: 어디서든 접속 가능

## 현재 로컬 접속 방법
- **같은 Wi-Fi**: `http://192.168.0.21:3000/webrtc-multiplayer.html`
- **로컬**: `http://localhost:3000/webrtc-multiplayer.html` 