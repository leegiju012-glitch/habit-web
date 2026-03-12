import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, query, where, getCountFromServer, getDocs, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

document.addEventListener("DOMContentLoaded", () => {
  const firebaseConfig = {
    apiKey: "AIzaSyBKGufJEWjipBfI77A51M0R7iD5kHpcj3o",
    authDomain: "a-compulsory-challenge.firebaseapp.com",
    projectId: "a-compulsory-challenge",
    storageBucket: "a-compulsory-challenge.firebasestorage.app",
    messagingSenderId: "637088399262",
    appId: "1:637088399262:web:c1128d0b95fe7f7337e08f"
  };

  const ADMIN_EMAILS = ["leegiju012@gmail.com"];

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app, "asia-northeast3");

  const backProfileBtn = document.getElementById("backProfileBtn");
  const backLobbyBtn = document.getElementById("backLobbyBtn");
  const statUsers = document.getElementById("statUsers");
  const statWaiting = document.getElementById("statWaiting");
  const statActive = document.getElementById("statActive");
  const statCheckins = document.getElementById("statCheckins");
  const roomList = document.getElementById("roomList");
  const runCleanupBtn = document.getElementById("runCleanupBtn");
  const cleanupResult = document.getElementById("cleanupResult");

  backProfileBtn.onclick = () => { location.href = "/profile.html"; };
  backLobbyBtn.onclick = () => { location.href = "/index.html"; };

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      location.href = "/";
      return;
    }

    if (!ADMIN_EMAILS.includes(user.email || "")) {
      alert("운영 대시보드 접근 권한이 없습니다.");
      location.href = "/profile.html";
      return;
    }

    try {
      const usersQ = query(collection(db, "users"));
      const waitingQ = query(collection(db, "groups"), where("status", "==", "waiting"));
      const activeQ = query(collection(db, "groups"), where("status", "==", "active"));
      const checkinsQ = query(collection(db, "checkins"), where("date", "==", todayStr()));

      const [usersCnt, waitingCnt, activeCnt, checkinsCnt] = await Promise.all([
        getCountFromServer(usersQ),
        getCountFromServer(waitingQ),
        getCountFromServer(activeQ),
        getCountFromServer(checkinsQ)
      ]);

      statUsers.textContent = String(usersCnt.data().count);
      statWaiting.textContent = String(waitingCnt.data().count);
      statActive.textContent = String(activeCnt.data().count);
      statCheckins.textContent = String(checkinsCnt.data().count);

      const waitingRoomsSnap = await getDocs(query(waitingQ, limit(20)));
      roomList.innerHTML = "";
      if (waitingRoomsSnap.empty) {
        const li = document.createElement("li");
        li.className = "item";
        li.innerHTML = '<div class="item-left"><div class="item-name">대기 방 없음</div><div class="item-sub">현재 대기 상태 방이 없습니다.</div></div>';
        roomList.appendChild(li);
      } else {
        waitingRoomsSnap.docs.forEach((d) => {
          const room = d.data();
          const li = document.createElement("li");
          li.className = "item";
          const members = Array.isArray(room.members) ? room.members.length : 0;
          li.innerHTML =
            `<div class="item-left">` +
            `<div class="item-name">${room.title || "제목 없는 방"}</div>` +
            `<div class="item-sub">${room.topic || "주제 미설정"}</div>` +
            `<div class="item-sub">코드 ${room.roomCode || "-"} · ${members}/5 · ${room.visibility === "private" ? "비공개" : "공개"}</div>` +
            `</div>`;
          roomList.appendChild(li);
        });
      }

      runCleanupBtn.onclick = async () => {
        runCleanupBtn.disabled = true;
        try {
          const runCleanup = httpsCallable(functions, "runMaintenanceCleanup");
          const res = await runCleanup({});
          const d = res?.data || {};
          cleanupResult.textContent =
            `정리 완료 · checkins ${d.deletedCheckins || 0}, 닫힌방 ${d.deletedClosedGroups || 0}, ` +
            `비밀문서 ${d.deletedGroupSecrets || 0}, 유저정리 ${d.resetDanglingUsers || 0}`;
        } catch (err) {
          console.error("runMaintenanceCleanup failed", err);
          cleanupResult.textContent = "정리 실행 실패";
          alert(typeof err?.details === "string" ? err.details : "정리 실행 중 오류가 발생했습니다.");
        } finally {
          runCleanupBtn.disabled = false;
        }
      };
    } catch (err) {
      console.error("admin dashboard load failed", err);
      alert("대시보드 로딩 중 오류가 발생했습니다.");
    }
  });
});
