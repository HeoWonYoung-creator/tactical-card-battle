# Cast Me If You Can - 마법 주문 배틀

WebRTC를 사용한 실시간 멀티플레이어 마법 주문 배틀 게임입니다.

## 🚀 서버 실행 방법

### 1. 의존성 설치
```bash
npm install
```

### 2. 서버 시작
```bash
npm start
```

또는 개발 모드로 실행:
```bash
npm run dev
```

서버가 `http://localhost:3000`에서 시작됩니다.

## 🎮 게임 실행 방법

1. 서버가 실행된 후 `webrtc-multiplayer.html` 파일을 브라우저에서 열어주세요.
2. 타이틀 화면에서 지팡이 주인 이름을 설정하고 저장합니다.
3. **모의 결투**: AI와 대전 (난이도 선택 가능)
4. **정식 결투**: 다른 플레이어와 실시간 대전

## 🔧 기술 스택

- **프론트엔드**: HTML5, CSS3, JavaScript (Vanilla)
- **백엔드**: Node.js, Express
- **실시간 통신**: Socket.IO
- **P2P 연결**: WebRTC

## 📡 서버 기능

- **플레이어 매칭**: 대기 중인 플레이어들을 자동으로 매칭
- **WebRTC 시그널링**: Offer/Answer/ICE Candidate 교환
- **게임 상태 동기화**: 실시간 게임 상태 업데이트
- **연결 관리**: 플레이어 연결 상태 모니터링
- **랭킹 시스템**: AI 대전 및 멀티플레이어 랭킹 관리

## 🎯 게임 규칙

### 기본 규칙
1. **마법 주문**: 각 플레이어는 6개의 마법 주문을 받습니다
2. **연속 영창**: 성공한 주문보다 높은 숫자의 주문만 시전 가능
3. **승리 조건**: 
   - 상대방의 체력을 0으로 만들거나
   - 자신의 마법 주문을 모두 사용
4. **패배 조건**: 체력이 0이 되거나 모든 주문을 사용

### 마법 주문 종류
- **1번 - 운명 변환**: 비밀 주문 3개를 공개
- **2번 - 마력 착취**: 상대 체력 -1, 자신 체력 +1
- **3번 - 정신 교란**: 비밀 주문 하나를 상대 패에 추가
- **4번 - 화염 화살**: 상대 체력 -1
- **5번 - 생명 물약**: 자신 체력 +1 (최대 3)
- **6번 - 명상**: 비밀 주문 1개를 공개

### 게임 진행
1. **턴 제한**: 각 턴은 30초 제한
2. **연속 영창**: 성공 시 같은 주문이나 더 높은 주문으로 연속 시전 가능
3. **실패 페널티**: 주문 시전 실패 시 체력 -1, 턴 종료
4. **도망**: 언제든지 도망 가능 (패배 처리)

## 🏆 랭킹 시스템

### AI 대전 랭킹
- **입문용 허수아비**: 쉬운 난이도
- **훈련용 허수아비**: 보통 난이도  
- **고수용 허수아비**: 어려운 난이도

### 멀티플레이어 랭킹
- 실시간 플레이어 간 대전 기록
- 승률 및 연승 기록 관리

## 🎨 게임 특징

### 시각적 효과
- **성공/실패 애니메이션**: 주문 시전 결과 시각화
- **체력 표시**: 하트 아이콘으로 체력 표시
- **턴 게이지**: 남은 시간을 시각적으로 표시
- **사운드 효과**: 주문 시전, 성공, 실패 시 사운드

### 사용자 경험
- **이름 설정**: 타이틀 화면에서 플레이어 이름 설정
- **전적 관리**: 승률, 연승 기록 자동 저장
- **실시간 로그**: 게임 진행 상황 실시간 표시
- **모달 알림**: 중요한 게임 이벤트 시 알림

## 🔍 디버깅

- **브라우저 콘솔**: 클라이언트 로그 확인
- **서버 콘솔**: 서버 상태 및 연결 로그 확인
- **디버그 패널**: 게임 중 Ctrl+D로 디버그 패널 토글

## 📊 서버 상태

서버는 30초마다 다음 정보를 출력합니다:
- 총 연결 수
- 활성 게임 수
- 대기 중인 플레이어 수
- 총 매칭 수

## 🛠️ 개발 모드

`npm run dev`로 실행하면 파일 변경 시 자동으로 서버가 재시작됩니다.

## 🎮 게임 모드

### 싱글플레이어 (AI 대전)
- 3가지 난이도 선택 가능
- 연습 및 전략 테스트용

### 멀티플레이어 (실시간 대전)
- WebRTC P2P 연결
- 실시간 게임 상태 동기화
- 랭킹 시스템 연동

## 📱 호환성

- **브라우저**: Chrome, Firefox, Safari, Edge 최신 버전
- **네트워크**: WebRTC 지원 환경 필요
- **디바이스**: 데스크톱, 태블릿, 모바일 지원 