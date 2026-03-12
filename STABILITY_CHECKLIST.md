# Stability Checklist

## 1) Core Flow
- Google 로그인 후 로비가 정상 표시되는지 확인
- `방 생성`으로 공개방 생성 후 즉시 `내 그룹으로 가기` 노출 확인
- 다른 계정에서 `방 참가`로 코드 입장 확인
- 방장 `챌린지 시작` 동작 확인
- 멤버 인증 업로드 후 그룹 화면 자동 반영 확인(새로고침 없이)
- 인증 완료 후 `사진 변경/삭제` 동작 확인
- 방장 `방 해산` 동작 확인
- 마지막 멤버 나가기 시 자동 방 삭제 확인

## 2) Rules / Permission
- 비로그인 상태에서 `group.html`, `profile.html`, `admin.html` 접근 시 리다이렉트 확인
- 비공개방 비밀번호 오입력 시 입장 거부 확인
- 일반 사용자 `admin.html` 접근 차단 확인

## 3) Error UX
- 함수 오류 발생 시 사용자에게 한국어 메시지가 표시되는지 확인
- 콘솔에는 함수명/uid/groupId 포함 에러 로그가 남는지 확인

## 4) Ops Dashboard
- `admin.html`에서 총 사용자/대기방/진행방/오늘 인증 수가 조회되는지 확인
- 대기실 샘플 목록이 최대 20개 노출되는지 확인

## Quick Command
```bash
npm run check:stability
```
