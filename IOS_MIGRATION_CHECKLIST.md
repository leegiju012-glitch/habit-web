# iOS Migration Checklist (Web -> App Store)

## 1. App Shell
- [ ] Capacitor iOS project build succeeds on Xcode (Release)
- [ ] App icon / launch screen assets finalized
- [ ] Bundle ID fixed (production)
- [ ] Versioning policy fixed (`CFBundleShortVersionString`, `CFBundleVersion`)

## 2. Auth / Session
- [ ] Google sign-in works inside iOS WebView or native bridge flow
- [ ] Session persistence verified after app restart
- [ ] Login failure fallback messages localized

## 3. Core Flows
- [ ] Lobby: create/join room, room visibility/password
- [ ] Group: start, check-in submit/edit/delete, approve/reject, dissolve
- [ ] Profile: nickname update and streak visibility
- [ ] Admin page hidden for non-admin user

## 4. Push / Notifications
- [ ] APNs key/cert configured in Firebase
- [ ] FCM token collection validated on iOS device
- [ ] Notification open action routes to right screen
- [ ] Event notifications tested: group start/close, approve/reject

## 5. Data / Security
- [ ] Firestore rules reviewed for iOS client parity
- [ ] Storage rules for check-in uploads reviewed
- [ ] Abuse controls (rate limiting, malformed payload handling) checked

## 6. Reliability / Cost
- [ ] Scheduled maintenance cleanup runs daily (KST)
- [ ] Error dashboard shows latest client/function failures
- [ ] Performance budget verified on real device (slow network)

## 7. App Store Connect
- [ ] App metadata (name/subtitle/description/keywords)
- [ ] Privacy policy URL and support URL
- [ ] App Privacy answers completed (Firebase usage)
- [ ] Screenshots for required iPhone sizes
- [ ] TestFlight internal test pass
- [ ] Submit for review

## Current Project Notes
- Daily reset logic is local-date based in client.
- Group screen uses realtime snapshots + cache-first rendering.
- Client failure logs are saved to `clientErrors` and visible in admin dashboard.
- Scheduled cleanup function is configured for `0 0 * * *` Asia/Seoul.
