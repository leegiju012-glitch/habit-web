import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc, serverTimestamp, getDoc, collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { getMessaging, getToken } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

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
  const messaging = getMessaging(app);

  const goGroupBtn = document.getElementById("goGroupBtn");
  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const statusPill = document.getElementById("statusPill");
  const profileBox = document.getElementById("profileBox");
  const userName = document.getElementById("userName");
  const userMail = document.getElementById("userMail");
  const avatarBox = document.getElementById("avatarBox");
  const nicknameBox = document.getElementById("nicknameBox");
  const nicknameInput = document.getElementById("nicknameInput");
  const saveNickBtn = document.getElementById("saveNickBtn");

  const roomCreateBox = document.getElementById("roomCreateBox");
  const roomTitleInput = document.getElementById("roomTitleInput");
  const roomTopicInput = document.getElementById("roomTopicInput");
  const roomPrivacySelect = document.getElementById("roomPrivacySelect");
  const roomPasswordInput = document.getElementById("roomPasswordInput");
  const createRoomBtn = document.getElementById("createRoomBtn");
  const myRoomPill = document.getElementById("myRoomPill");

  const roomListBox = document.getElementById("roomListBox");
  const roomList = document.getElementById("roomList");

  let userDocUnsub = null;
  let roomListUnsub = null;
  let latestRooms = [];
  let currentUserGroupId = null;

  function extractFunctionErrorMessage(err, fallback) {
    if (err?.details && typeof err.details === "string") return err.details;
    if (err?.message && typeof err.message === "string") {
      if (err.message.startsWith("internal") || err.message === "INTERNAL") return fallback;
      return err.message;
    }
    return fallback;
  }

  function isValidNickname(value) {
    const nickname = (value || "").trim();
    return nickname.length >= 2 && nickname.length <= 10;
  }

  function setLobbyEnabled(enabled) {
    createRoomBtn.disabled = !enabled;
    roomTitleInput.disabled = !enabled;
    roomTopicInput.disabled = !enabled;
    roomPrivacySelect.disabled = !enabled;
    roomPasswordInput.disabled = !enabled;
  }

  function renderRoomList(currentGroupId) {
    if (!roomList) return;
    roomList.innerHTML = "";

    if (!latestRooms.length) {
      const li = document.createElement("li");
      li.className = "item";
      li.innerHTML = '<div class="item-left"><div class="item-name">대기 중인 방이 없습니다.</div><div class="item-sub">새 방을 만들어 시작해보세요.</div></div>';
      roomList.appendChild(li);
      return;
    }

    for (const room of latestRooms) {
      const li = document.createElement("li");
      li.className = "item";

      const membersCount = Array.isArray(room.members) ? room.members.length : 0;
      const topic = room.topic || "주제 미설정";
      const title = room.title || "제목 없는 방";
      const visibilityLabel = room.visibility === "private" ? "비공개" : "공개";
      const isMine = currentGroupId && currentGroupId === room.id;

      const left = document.createElement("div");
      left.className = "item-left";
      const nameEl = document.createElement("div");
      nameEl.className = "item-name";
      nameEl.textContent = title;
      const topicEl = document.createElement("div");
      topicEl.className = "item-sub";
      topicEl.textContent = topic;
      const metaEl = document.createElement("div");
      metaEl.className = "item-sub";
      metaEl.textContent = `${visibilityLabel} · ${membersCount}/5`;
      left.appendChild(nameEl);
      left.appendChild(topicEl);
      left.appendChild(metaEl);

      const joinBtn = document.createElement("button");
      joinBtn.className = "btn ghost";
      joinBtn.style.width = "auto";
      joinBtn.style.padding = "8px 12px";
      joinBtn.style.borderRadius = "10px";
      joinBtn.textContent = isMine ? "참여 중" : "입장";
      joinBtn.disabled = !!isMine || membersCount >= 5;

      joinBtn.onclick = () => joinRoom(room);

      li.appendChild(left);
      li.appendChild(joinBtn);
      roomList.appendChild(li);
    }
  }

  function renderLobbyState(userData) {
    const inGroup = !!userData.currentGroupId;

    goGroupBtn.style.display = inGroup ? "block" : "none";
    roomCreateBox.style.display = "block";
    roomListBox.style.display = "block";

    if (inGroup) {
      setLobbyEnabled(false);
      myRoomPill.style.display = "inline-flex";
      myRoomPill.textContent = `참여 중인 방 ID: ${userData.currentGroupId}`;
    } else {
      setLobbyEnabled(true);
      myRoomPill.style.display = "none";
      myRoomPill.textContent = "";
    }

    renderRoomList(userData.currentGroupId || null);
  }

  async function ensureNickname(user) {
    const nickname = nicknameInput.value.trim();
    if (!isValidNickname(nickname)) {
      alert("입장 전에 닉네임을 2~10자로 저장해 주세요.");
      return null;
    }

    await setDoc(doc(db, "users", user.uid), { nickname }, { merge: true });
    return nickname;
  }

  async function joinRoom(room) {
    const user = auth.currentUser;
    if (!user) return;

    try {
      createRoomBtn.disabled = true;
      const nickname = await ensureNickname(user);
      if (!nickname) return;

      let password = "";

      if (room.visibility === "private") {
        password = prompt("비공개방 비밀번호를 입력하세요.") || "";
        if (!password) return;
      }

      const joinRoomFn = httpsCallable(functions, "joinRoom");
      await joinRoomFn({ groupId: room.id, password });

      alert("방에 입장했습니다.");
    } catch (err) {
      console.error("joinRoom failed", err);
      alert(extractFunctionErrorMessage(err, "입장 처리 중 오류가 발생했습니다."));
    } finally {
      renderRoomList(currentUserGroupId);
      createRoomBtn.disabled = false;
    }
  }

  loginBtn.onclick = () => signInWithPopup(auth, provider);
  logoutBtn.onclick = () => signOut(auth);
  goGroupBtn.onclick = () => {
    location.href = "/group.html";
  };

  saveNickBtn.onclick = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const nickname = nicknameInput.value.trim();
    if (!isValidNickname(nickname)) {
      alert("닉네임은 2~10자로 입력해 주세요.");
      return;
    }

    saveNickBtn.disabled = true;
    try {
      await setDoc(doc(db, "users", user.uid), { nickname }, { merge: true });
      alert("닉네임이 저장되었습니다.");
    } catch (err) {
      console.error("saveNick failed", err);
      alert("닉네임 저장 중 오류가 발생했습니다.");
    } finally {
      saveNickBtn.disabled = false;
    }
  };

  createRoomBtn.onclick = async () => {
    const user = auth.currentUser;
    if (!user) return;

    createRoomBtn.disabled = true;
    try {
      const nickname = await ensureNickname(user);
      if (!nickname) return;

      const mySnap = await getDoc(doc(db, "users", user.uid));
      if (mySnap.exists() && mySnap.data().currentGroupId) {
        alert("이미 참여 중인 방이 있습니다.");
        return;
      }

      const title = (roomTitleInput.value || "").trim();
      const topic = (roomTopicInput.value || "").trim();
      const visibility = roomPrivacySelect.value === "private" ? "private" : "public";
      const password = (roomPasswordInput.value || "").trim();

      if (!title) {
        alert("방 이름을 입력해 주세요.");
        return;
      }

      if (!topic) {
        alert("주제를 입력해 주세요.");
        return;
      }

      if (visibility === "private") {
        if (password.length < 4) {
          alert("비공개방 비밀번호는 4자 이상 입력해 주세요.");
          return;
        }
      }

      const createRoomFn = httpsCallable(functions, "createRoom");
      const result = await createRoomFn({ title, topic, visibility, password });
      const createdTitle = result?.data?.title || title;

      myRoomPill.style.display = "inline-flex";
      myRoomPill.textContent = `내 방: ${createdTitle}`;
      alert("방이 생성되었습니다.");

      roomTitleInput.value = "";
      roomTopicInput.value = "";
      roomPasswordInput.value = "";
      roomPrivacySelect.value = "public";
    } catch (err) {
      console.error("createRoom failed", err);
      alert(extractFunctionErrorMessage(err, "방 생성 중 오류가 발생했습니다."));
    } finally {
      createRoomBtn.disabled = false;
    }
  };

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

      loginBtn.style.display = "block";
      logoutBtn.style.display = "none";
      goGroupBtn.style.display = "none";
      statusPill.textContent = "오프라인";
      profileBox.style.display = "none";
      nicknameBox.style.display = "none";
      roomCreateBox.style.display = "none";
      roomListBox.style.display = "none";
      myRoomPill.style.display = "none";
      latestRooms = [];
      renderRoomList(null);
      return;
    }

    const userRef = doc(db, "users", user.uid);

    if (Notification.permission !== "granted") {
      await Notification.requestPermission();
    }

    if (Notification.permission === "granted") {
      try {
        const token = await getToken(messaging, {
          vapidKey: "BBew8s0bi1q5yWspgXoTMvHjAoTsFA0BQ8YW3N2-sGvc7Qsr1Xj-AyYM5Kc5RRQLZukoSNwA2hEiex_MsdRVriY"
        });

        if (token) {
          await setDoc(userRef, { fcmToken: token }, { merge: true });
        }
      } catch (err) {
        console.error("fcm token failed", err);
      }
    }

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
        createdAt: serverTimestamp()
      });
      userSnap = await getDoc(userRef);
    }

    const myData = userSnap.data();

    loginBtn.style.display = "none";
    logoutBtn.style.display = "block";
    profileBox.style.display = "flex";
    nicknameBox.style.display = "flex";
    roomCreateBox.style.display = "block";
    roomListBox.style.display = "block";
    statusPill.textContent = "온라인";

    userName.textContent = myData.nickname || user.displayName || "사용자";
    userMail.textContent = user.email || "";
    nicknameInput.value = myData.nickname || "";

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
      userName.textContent = latest.nickname || user.displayName || "사용자";
      if (document.activeElement !== nicknameInput) {
        nicknameInput.value = latest.nickname || "";
      }
      renderLobbyState(latest);
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

    currentUserGroupId = myData.currentGroupId || null;
    renderLobbyState(myData);
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js");
  }
});
