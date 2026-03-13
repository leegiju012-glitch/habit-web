import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc, serverTimestamp, getDoc, collection, query, where, onSnapshot, addDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
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

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app, "asia-northeast3");
  const provider = new GoogleAuthProvider();
  setPersistence(auth, browserLocalPersistence).catch((err) => {
    console.warn("auth persistence setup failed", err);
  });

  const loginBtn = document.getElementById("loginBtn");
  const backLobbyBtn = document.getElementById("backLobbyBtn");
  const goGroupBtn = document.getElementById("goGroupBtn");
  const navBox = document.getElementById("navBox");

  const profileBox = document.getElementById("profileBox");
  const userName = document.getElementById("userName");
  const userMail = document.getElementById("userMail");
  const avatarBox = document.getElementById("avatarBox");

  const roomListBox = document.getElementById("roomListBox");
  const roomList = document.getElementById("roomList");
  const roomCodeInput = document.getElementById("roomCodeInput");
  const joinByCodeBtn = document.getElementById("joinByCodeBtn");

  let userDocUnsub = null;
  let roomListUnsub = null;
  let latestRooms = [];
  let currentUserGroupId = null;

  function isValidNickname(value) {
    const nickname = (value || "").trim();
    return nickname.length >= 2 && nickname.length <= 10;
  }

  function extractFunctionErrorMessage(err, fallback) {
    if (err?.details && typeof err.details === "string") return err.details;
    if (err?.message && typeof err.message === "string") {
      if (err.message.startsWith("internal") || err.message === "INTERNAL") return fallback;
      return err.message;
    }
    if (err?.code && typeof err.code === "string") return `${fallback} (${err.code})`;
    return fallback;
  }

  async function logClientError(type, err, extra = {}) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      await addDoc(collection(db, "clientErrors"), {
        uid,
        type,
        code: String(err?.code || ""),
        message: String(err?.message || "unknown"),
        page: "enter-room",
        extra,
        createdAt: serverTimestamp()
      });
    } catch (_) {
      // no-op
    }
  }

  function renderRoomList(currentGroupId) {
    if (!roomList) return;
    roomList.innerHTML = "";

    if (!latestRooms.length) {
      const li = document.createElement("li");
      li.className = "item";
      li.innerHTML = '<div class="item-left"><div class="item-name">대기 중인 방이 없습니다.</div><div class="item-sub">지금은 입장 가능한 방이 없어요.</div></div>';
      roomList.appendChild(li);
      return;
    }

    for (const room of latestRooms) {
      const li = document.createElement("li");
      li.className = "item";

      const membersCount = Array.isArray(room.members) ? room.members.length : 0;
      const title = room.title || "제목 없는 방";
      const topic = room.topic || "주제 미설정";
      const visibilityLabel = room.visibility === "private" ? "비공개" : "공개";
      const roomCode = room.roomCode || "-";
      const isMine = currentGroupId && currentGroupId === room.id;

      const left = document.createElement("div");
      left.className = "item-left";
      left.innerHTML = `
        <div class="item-name">${title}</div>
        <div class="item-sub">${topic}</div>
        <div class="item-sub">${visibilityLabel} · ${membersCount}/5 · 코드 ${roomCode}</div>
      `;

      const joinBtn = document.createElement("button");
      joinBtn.className = "btn ghost";
      joinBtn.style.width = "auto";
      joinBtn.style.padding = "8px 12px";
      joinBtn.style.borderRadius = "10px";
      joinBtn.textContent = isMine ? "참여 중" : "입장";
      joinBtn.disabled = !!isMine || membersCount >= 5 || !!currentGroupId;
      joinBtn.onclick = () => joinRoom(room);

      li.appendChild(left);
      li.appendChild(joinBtn);
      roomList.appendChild(li);
    }
  }

  async function ensureNickname(user) {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    const currentNickname = (userSnap.exists() ? userSnap.data()?.nickname : "") || "";
    const fallbackNickname = (user.displayName || "사용자").trim().slice(0, 10);
    const nickname = isValidNickname(currentNickname) ? currentNickname : fallbackNickname;
    if (!isValidNickname(nickname)) return null;
    await setDoc(userRef, { nickname }, { merge: true });
    return nickname;
  }

  async function joinRoom(room) {
    const user = auth.currentUser;
    if (!user) return;
    if (currentUserGroupId) {
      alert("이미 참여 중인 방이 있습니다.");
      return;
    }

    try {
      joinByCodeBtn.disabled = true;
      const nickname = await ensureNickname(user);
      if (!nickname) return;

      let password = "";
      if (room.visibility === "private") {
        password = (prompt("비공개방 비밀번호를 입력하세요. (4자 이상)") || "").trim();
        if (!password) return;
        if (password.length < 4) {
          alert("비밀번호는 4자 이상 입력해 주세요.");
          return;
        }
      }

      const joinRoomFn = httpsCallable(functions, "joinRoom");
      await joinRoomFn({ groupId: room.id, password });
      alert("방에 입장했습니다.");
    } catch (err) {
      console.error("joinRoom failed", err);
      await logClientError("joinRoom_failed", err, { roomId: room.id || null, visibility: room.visibility || "public" });
      alert(extractFunctionErrorMessage(err, "입장 처리 중 오류가 발생했습니다."));
    } finally {
      joinByCodeBtn.disabled = false;
    }
  }

  async function joinRoomByCode() {
    const code = (roomCodeInput.value || "").trim().toUpperCase();
    if (!code) {
      alert("방 코드를 입력해 주세요.");
      return;
    }

    const target = latestRooms.find((r) => (r.roomCode || "").toUpperCase() === code);
    if (!target) {
      alert("해당 코드의 대기실을 찾을 수 없습니다.");
      return;
    }
    await joinRoom(target);
  }

  if (loginBtn) {
    loginBtn.onclick = async () => {
      try {
        await signInWithPopup(auth, provider);
      } catch (err) {
        console.error("login failed", err);
        alert("로그인 팝업이 차단되었거나 실패했습니다. 주소창 브라우저에서 팝업 허용 후 다시 시도해 주세요.");
      }
    };
  }

  if (backLobbyBtn) backLobbyBtn.onclick = () => { location.href = "/index.html"; };
  if (goGroupBtn) goGroupBtn.onclick = () => { location.href = "/group.html"; };
  if (joinByCodeBtn) joinByCodeBtn.onclick = joinRoomByCode;

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      if (userDocUnsub) {
        userDocUnsub();
        userDocUnsub = null;
      }
      if (roomListUnsub) {
        roomListUnsub();
        roomListUnsub = null;
      }

      if (loginBtn) loginBtn.style.display = "block";
      if (navBox) navBox.style.display = "none";
      if (goGroupBtn) goGroupBtn.style.display = "none";
      if (profileBox) profileBox.style.display = "none";
      if (roomListBox) roomListBox.style.display = "none";
      if (roomList) roomList.innerHTML = "";
      latestRooms = [];
      currentUserGroupId = null;
      return;
    }

    const userRef = doc(db, "users", user.uid);
    let userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        name: user.displayName || "",
        nickname: user.displayName || "",
        email: user.email || "",
        photoURL: user.photoURL || "",
        currentGroupId: null,
        currentGroupInviteCode: null,
        currentChallengeStreak: 0,
        lastChallengeStreak: 0,
        createdAt: serverTimestamp()
      });
      userSnap = await getDoc(userRef);
    }
    const myData = userSnap.data();

    if (loginBtn) loginBtn.style.display = "none";
    if (navBox) navBox.style.display = "flex";
    if (profileBox) profileBox.style.display = "flex";
    if (roomListBox) roomListBox.style.display = "block";

    if (userName) userName.textContent = myData.nickname || user.displayName || "사용자";
    if (userMail) userMail.textContent = user.email || "";
    currentUserGroupId = myData.currentGroupId || null;
    if (goGroupBtn) goGroupBtn.style.display = currentUserGroupId ? "block" : "none";

    avatarBox.innerHTML = "";
    if (user.photoURL) {
      const img = document.createElement("img");
      img.src = user.photoURL;
      avatarBox.appendChild(img);
    }

    if (userDocUnsub) userDocUnsub();
    userDocUnsub = onSnapshot(userRef, (snap) => {
      if (!snap.exists()) return;
      const latest = snap.data();
      currentUserGroupId = latest.currentGroupId || null;
      if (userName) userName.textContent = latest.nickname || user.displayName || "사용자";
      if (goGroupBtn) goGroupBtn.style.display = currentUserGroupId ? "block" : "none";
      renderRoomList(currentUserGroupId);
    });

    if (roomListUnsub) roomListUnsub();
    const waitingRoomsQuery = query(collection(db, "groups"), where("status", "==", "waiting"));
    roomListUnsub = onSnapshot(waitingRoomsQuery, (snap) => {
      latestRooms = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      latestRooms.sort((a, b) => {
        const at = a.createdAt?.seconds || 0;
        const bt = b.createdAt?.seconds || 0;
        return bt - at;
      });
      renderRoomList(currentUserGroupId);
    });
  });
});
