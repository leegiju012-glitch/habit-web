import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc, serverTimestamp, getDoc, onSnapshot, collection, addDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { getMessaging, getToken, isSupported as isMessagingSupported } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

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
  let messaging = null;
  isMessagingSupported()
    .then((supported) => {
      if (supported) messaging = getMessaging(app);
    })
    .catch(() => {
      messaging = null;
    });

  const loginRow = document.getElementById("loginRow");
  const goProfileBtn = document.getElementById("goProfileBtn");
  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const profileBox = document.getElementById("profileBox");
  const userName = document.getElementById("userName");
  const userMail = document.getElementById("userMail");
  const avatarBox = document.getElementById("avatarBox");

  const roomCreateBox = document.getElementById("roomCreateBox");
  const roomTitleInput = document.getElementById("roomTitleInput");
  const roomTopicInput = document.getElementById("roomTopicInput");
  const roomRuleInput = document.getElementById("roomRuleInput");
  const roomPrivacySelect = document.getElementById("roomPrivacySelect");
  const roomPasswordInput = document.getElementById("roomPasswordInput");
  const createRoomBtn = document.getElementById("createRoomBtn");
  const myRoomSection = document.getElementById("myRoomSection");
  const myRoomList = document.getElementById("myRoomList");
  const roomActionBox = document.getElementById("roomActionBox");
  const enterRoomBtn = document.getElementById("enterRoomBtn");
  const openCreateRoomBtn = document.getElementById("openCreateRoomBtn");

  let userDocUnsub = null;
  let currentUserGroupId = null;
  let currentUserJoinedGroupIds = [];
  let currentUserPlan = "free";
  let createFormVisible = false;
  const groupTitleCache = new Map();

  async function safeRequestNotificationPermission() {
    try {
      if (!("Notification" in window)) return;
      if (Notification.permission === "default") {
        await Notification.requestPermission();
      }
    } catch (err) {
      console.warn("notification permission skipped", err);
    }
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
        page: "lobby",
        extra,
        createdAt: serverTimestamp()
      });
    } catch (_) {
      // no-op
    }
  }

  function isValidNickname(value) {
    const nickname = (value || "").trim();
    return nickname.length >= 2 && nickname.length <= 10;
  }

  function maxGroupsForPlan(plan) {
    return plan === "pro" ? 5 : 1;
  }

  function setLobbyEnabled(enabled) {
    if (createRoomBtn) createRoomBtn.disabled = !enabled;
    if (roomTitleInput) roomTitleInput.disabled = !enabled;
    if (roomTopicInput) roomTopicInput.disabled = !enabled;
    if (roomRuleInput) roomRuleInput.disabled = !enabled;
    if (roomPrivacySelect) roomPrivacySelect.disabled = !enabled;
    if (roomPasswordInput) roomPasswordInput.disabled = !enabled;
    if (enterRoomBtn) enterRoomBtn.disabled = !enabled;
    if (openCreateRoomBtn) openCreateRoomBtn.disabled = !enabled;
  }

  function setCreateFormVisible(visible) {
    createFormVisible = visible;
    if (roomCreateBox) roomCreateBox.style.display = visible ? "block" : "none";
    if (openCreateRoomBtn) {
      openCreateRoomBtn.textContent = visible ? "방 만들기 닫기" : "방 만들기";
    }
    updatePasswordFieldVisibility();
  }

  function updatePasswordFieldVisibility() {
    if (!roomPasswordInput || !roomPrivacySelect) return;
    const isPrivate = roomPrivacySelect.value === "private";
    roomPasswordInput.style.display = isPrivate ? "block" : "none";
    roomPasswordInput.disabled = !isPrivate;
    if (!isPrivate) roomPasswordInput.value = "";
  }

  function renderLobbyState(userData) {
    const inGroup = !!userData.currentGroupId;
    const plan = userData?.plan === "pro" ? "pro" : "free";
    const joined = Array.isArray(userData?.joinedGroupIds)
      ? userData.joinedGroupIds.filter((gid) => typeof gid === "string" && gid)
      : (userData?.currentGroupId ? [userData.currentGroupId] : []);
    const atLimit = joined.length >= maxGroupsForPlan(plan);
    if (roomActionBox) roomActionBox.style.display = "flex";

    if (inGroup) {
      // 참여 중이어도 다중 방 전환/참가 흐름을 위해 버튼은 계속 노출한다.
      setLobbyEnabled(true);
      if (createRoomBtn) createRoomBtn.disabled = atLimit;
      setCreateFormVisible(createFormVisible);
      renderMyRooms(userData);
    } else {
      setLobbyEnabled(true);
      if (roomActionBox) roomActionBox.style.display = "flex";
      if (createRoomBtn) createRoomBtn.disabled = atLimit;
      setCreateFormVisible(createFormVisible);
      renderMyRooms(userData);
    }
  }

  async function refreshGroupTitle(groupId) {
    if (!groupId) return;
    try {
      const groupSnap = await getDoc(doc(db, "groups", groupId));
      const title = groupSnap.exists() ? ((groupSnap.data()?.title || "").trim()) : "";
      groupTitleCache.set(groupId, title);
      const activeUserData = {
        currentGroupId: currentUserGroupId,
        joinedGroupIds: currentUserJoinedGroupIds
      };
      renderMyRooms(activeUserData);
    } catch (err) {
      console.warn("refreshGroupTitle failed", err);
    }
  }

  function goGroup(groupId) {
    if (!groupId) return;
    location.href = `/group.html?groupId=${encodeURIComponent(groupId)}`;
  }

  function renderMyRooms(userData) {
    if (!myRoomSection || !myRoomList) return;
    const joined = Array.isArray(userData?.joinedGroupIds)
      ? userData.joinedGroupIds.filter((gid) => typeof gid === "string" && gid)
      : (userData?.currentGroupId ? [userData.currentGroupId] : []);

    if (!joined.length) {
      myRoomSection.style.display = "none";
      myRoomList.innerHTML = "";
      return;
    }

    myRoomSection.style.display = "block";
    myRoomList.innerHTML = "";

    joined.forEach((groupId) => {
      const li = document.createElement("li");
      li.className = "item";

      const title = groupTitleCache.get(groupId) || "방 이름 불러오는 중...";
      const left = document.createElement("div");
      left.className = "item-left";
      left.innerHTML = `
        <div class="item-name">${title}</div>
        <div class="item-sub">ID ${groupId}</div>
      `;

      const openBtn = document.createElement("button");
      openBtn.className = "btn ghost compact";
      openBtn.textContent = "내 그룹으로 이동";
      openBtn.onclick = () => goGroup(groupId);

      li.appendChild(left);
      li.appendChild(openBtn);
      myRoomList.appendChild(li);
    });
  }

  async function ensureNickname(user) {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    const currentNickname = (userSnap.exists() ? userSnap.data()?.nickname : "") || "";
    const fallbackNickname = (user.displayName || "사용자").trim().slice(0, 10);
    const nickname = isValidNickname(currentNickname) ? currentNickname : fallbackNickname;
    if (!isValidNickname(nickname)) return null;
    await setDoc(doc(db, "users", user.uid), { nickname }, { merge: true });
    return nickname;
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
  if (logoutBtn) logoutBtn.onclick = () => signOut(auth);
  if (enterRoomBtn) {
    enterRoomBtn.onclick = () => {
      location.href = "/enter-room.html";
    };
  }
  if (openCreateRoomBtn) {
    openCreateRoomBtn.onclick = () => {
      setCreateFormVisible(!createFormVisible);
    };
  }
  if (roomPrivacySelect) {
    roomPrivacySelect.onchange = updatePasswordFieldVisibility;
  }
  if (goProfileBtn) {
    goProfileBtn.onclick = () => {
      location.href = "/profile.html";
    };
  }

  if (createRoomBtn) createRoomBtn.onclick = async () => {
    const user = auth.currentUser;
    if (!user || !roomTitleInput || !roomTopicInput || !roomRuleInput || !roomPrivacySelect || !roomPasswordInput) return;

    createRoomBtn.disabled = true;
    try {
      const nickname = await ensureNickname(user);
      if (!nickname) return;

      const mySnap = await getDoc(doc(db, "users", user.uid));
      const myData = mySnap.exists() ? mySnap.data() : {};
      const plan = myData?.plan === "pro" ? "pro" : "free";
      const joined = Array.isArray(myData?.joinedGroupIds)
        ? myData.joinedGroupIds.filter((gid) => typeof gid === "string" && gid)
        : (myData?.currentGroupId ? [myData.currentGroupId] : []);
      if (joined.length >= maxGroupsForPlan(plan)) {
        alert(plan === "pro" ? "Pro 이용권 최대 참여 방(5개)에 도달했습니다." : "무료는 1개 방만 참여할 수 있습니다.");
        return;
      }

      const title = (roomTitleInput.value || "").trim();
      const topic = (roomTopicInput.value || "").trim();
      const checkinRule = (roomRuleInput.value || "").trim();
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
      if (!checkinRule) {
        alert("인증 사진 규칙을 입력해 주세요.");
        return;
      }
      if (checkinRule.length > 120) {
        alert("인증 사진 규칙은 120자 이내로 입력해 주세요.");
        return;
      }

      if (visibility === "private") {
        if (password.length < 4) {
          alert("비공개방 비밀번호는 4자 이상 입력해 주세요.");
          return;
        }
      }

      const createRoomFn = httpsCallable(functions, "createRoom");
      await createRoomFn({ title, topic, checkinRule, visibility, password });
      alert("방이 생성되었습니다.");

      roomTitleInput.value = "";
      roomTopicInput.value = "";
      roomRuleInput.value = "";
      roomPasswordInput.value = "";
      roomPrivacySelect.value = "public";
      updatePasswordFieldVisibility();
    } catch (err) {
      console.error("createRoom failed", err);
      await logClientError("createRoom_failed", err, { visibility: roomPrivacySelect.value || "public" });
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

      if (loginRow) loginRow.style.display = "flex";
      if (loginBtn) loginBtn.style.display = "block";
      if (logoutBtn) logoutBtn.style.display = "none";
      if (goProfileBtn) goProfileBtn.style.display = "none";
      if (profileBox) profileBox.style.display = "none";
      if (roomCreateBox) roomCreateBox.style.display = "none";
      createFormVisible = false;
      if (roomActionBox) roomActionBox.style.display = "none";
      if (myRoomSection) myRoomSection.style.display = "none";
      if (myRoomList) myRoomList.innerHTML = "";
      return;
    }

    const userRef = doc(db, "users", user.uid);

    await safeRequestNotificationPermission();

    if (messaging && "Notification" in window && Notification.permission === "granted") {
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
        currentChallengeStreak: 0,
        lastChallengeStreak: 0,
        isAdFree: false,
        adFreePurchasedAt: null,
        plan: "free",
        joinedGroupIds: [],
        createdAt: serverTimestamp()
      });
      userSnap = await getDoc(userRef);
    }

    const myData = userSnap.data();

    if (loginRow) loginRow.style.display = "none";
    if (loginBtn) loginBtn.style.display = "none";
    if (logoutBtn) logoutBtn.style.display = "block";
    if (goProfileBtn) goProfileBtn.style.display = "block";
    if (profileBox) profileBox.style.display = "flex";
    if (roomCreateBox) roomCreateBox.style.display = "none";
    createFormVisible = false;
    if (roomActionBox) roomActionBox.style.display = "flex";

    if (userName) userName.textContent = myData.nickname || user.displayName || "사용자";
    if (userMail) userMail.textContent = user.email || "";

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
      currentUserJoinedGroupIds = Array.isArray(latest.joinedGroupIds)
        ? latest.joinedGroupIds.filter((gid) => typeof gid === "string" && gid)
        : (latest.currentGroupId ? [latest.currentGroupId] : []);
      currentUserPlan = latest.plan === "pro" ? "pro" : "free";
      if (userName) userName.textContent = latest.nickname || user.displayName || "사용자";
      renderLobbyState(latest);
      const joinedForTitle = Array.isArray(latest.joinedGroupIds)
        ? latest.joinedGroupIds.filter((gid) => typeof gid === "string" && gid)
        : (latest.currentGroupId ? [latest.currentGroupId] : []);
      for (const gid of joinedForTitle) {
        refreshGroupTitle(gid);
      }
    });

    currentUserGroupId = myData.currentGroupId || null;
    currentUserJoinedGroupIds = Array.isArray(myData.joinedGroupIds)
      ? myData.joinedGroupIds.filter((gid) => typeof gid === "string" && gid)
      : (myData.currentGroupId ? [myData.currentGroupId] : []);
    currentUserPlan = myData.plan === "pro" ? "pro" : "free";
    updatePasswordFieldVisibility();
    renderLobbyState(myData);
    const initialJoined = Array.isArray(myData.joinedGroupIds)
      ? myData.joinedGroupIds.filter((gid) => typeof gid === "string" && gid)
      : (myData.currentGroupId ? [myData.currentGroupId] : []);
    for (const gid of initialJoined) {
      refreshGroupTitle(gid);
    }
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js");
  }
});
