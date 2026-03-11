import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc, serverTimestamp, getDoc, getDocs, collection, query, where, limit, runTransaction, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
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
const provider = new GoogleAuthProvider();
const messaging = getMessaging(app);

const joinQueueBtn = document.getElementById("joinQueueBtn");
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
const privateGroupBox = document.getElementById("privateGroupBox");
const createPrivateGroupBtn = document.getElementById("createPrivateGroupBtn");
const inviteCodeInput = document.getElementById("inviteCodeInput");
const joinPrivateGroupBtn = document.getElementById("joinPrivateGroupBtn");
const myInviteCodePill = document.getElementById("myInviteCodePill");
let userDocUnsub = null;

function renderLobbyActions(currentGroupId, inviteCode) {
  privateGroupBox.style.display = "block";

  if (currentGroupId) {
    goGroupBtn.style.display = "block";
    joinQueueBtn.style.display = "none";
    createPrivateGroupBtn.disabled = true;
    joinPrivateGroupBtn.disabled = true;
    inviteCodeInput.disabled = true;
    if (inviteCode) {
      myInviteCodePill.style.display = "inline-flex";
      myInviteCodePill.textContent = "내 그룹 코드: " + inviteCode;
    } else {
      myInviteCodePill.style.display = "none";
      myInviteCodePill.textContent = "";
    }
    return;
  }

  goGroupBtn.style.display = "none";
  joinQueueBtn.style.display = "block";
  createPrivateGroupBtn.disabled = false;
  joinPrivateGroupBtn.disabled = false;
  inviteCodeInput.disabled = false;
  myInviteCodePill.style.display = "none";
  myInviteCodePill.textContent = "";
}

function isValidNickname(value) {
  const nickname = (value || "").trim();
  return nickname.length >= 2 && nickname.length <= 10;
}

function normalizeInviteCode(value) {
  return (value || "").trim().toUpperCase();
}

function generateInviteCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

async function ensureNickname(user) {
  const nickname = nicknameInput.value.trim();
  if (!isValidNickname(nickname)) {
    alert("매칭 전에 닉네임을 2~10자로 저장해 주세요.");
    return null;
  }
  await setDoc(doc(db, "users", user.uid), { nickname }, { merge: true });
  return nickname;
}

loginBtn.onclick = () => signInWithPopup(auth, provider);
logoutBtn.onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {

  if (!user) {
    if (userDocUnsub) {
      userDocUnsub();
      userDocUnsub = null;
    }

    loginBtn.style.display = "block";
    logoutBtn.style.display = "none";
    joinQueueBtn.style.display = "none";
    goGroupBtn.style.display = "none";
    statusPill.textContent = "오프라인";
    profileBox.style.display = "none";
    nicknameBox.style.display = "none";
    privateGroupBox.style.display = "none";
    myInviteCodePill.style.display = "none";
    return;
  }

  const userRef = doc(db, "users", user.uid);

  if (Notification.permission !== "granted") {
    await Notification.requestPermission();
  }

  if (Notification.permission === "granted") {
    const token = await getToken(messaging, {
      vapidKey: "BBew8s0bi1q5yWspgXoTMvHjAoTsFA0BQ8YW3N2-sGvc7Qsr1Xj-AyYM5Kc5RRQLZukoSNwA2hEiex_MsdRVriY"
    });

    if (token) {
      await setDoc(userRef, {
        fcmToken: token
      }, { merge: true });
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

  renderLobbyActions(myData.currentGroupId, myData.currentGroupInviteCode);

  if (userDocUnsub) {
    userDocUnsub();
  }

  userDocUnsub = onSnapshot(userRef, (snap) => {
    if (!snap.exists()) return;
    const latest = snap.data();
    userName.textContent = latest.nickname || user.displayName || "사용자";
    if (document.activeElement !== nicknameInput) {
      nicknameInput.value = latest.nickname || "";
    }
    renderLobbyActions(latest.currentGroupId, latest.currentGroupInviteCode);
  });
});

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

joinQueueBtn.onclick = async () => {
  const user = auth.currentUser;
  if (!user) return;

  try {
    joinQueueBtn.disabled = true;
    const nickname = await ensureNickname(user);
    if (!nickname) return;

    await setDoc(doc(db, "queue", user.uid), {
      uid: user.uid,
      createdAt: serverTimestamp()
    }, { merge: true });

    alert("매칭 대기열에 등록되었습니다.");
    const created = await tryMatchGroup();

    const latestUserSnap = await getDoc(doc(db, "users", user.uid));
    const latestGroupId = latestUserSnap.exists() ? latestUserSnap.data().currentGroupId : null;
    const latestInviteCode = latestUserSnap.exists() ? latestUserSnap.data().currentGroupInviteCode : null;
    renderLobbyActions(latestGroupId, latestInviteCode);

    if (!created && !latestGroupId) {
      alert("아직 그룹 매칭이 완료되지 않았습니다. 잠시 후 다시 확인해 주세요.");
    }
  } catch (err) {
    console.error("joinQueue failed", err);
    alert("매칭 처리 중 오류가 발생했습니다. 다시 시도해 주세요.");
  } finally {
    joinQueueBtn.disabled = false;
  }
};

createPrivateGroupBtn.onclick = async () => {
  const user = auth.currentUser;
  if (!user) return;

  createPrivateGroupBtn.disabled = true;
  joinPrivateGroupBtn.disabled = true;
  try {
    const nickname = await ensureNickname(user);
    if (!nickname) return;

    const mySnap = await getDoc(doc(db, "users", user.uid));
    if (mySnap.exists() && mySnap.data().currentGroupId) {
      alert("이미 참여 중인 그룹이 있습니다.");
      return;
    }

    let inviteCode = null;
    for (let i = 0; i < 10; i++) {
      const candidate = generateInviteCode(6);
      const dupSnap = await getDocs(query(collection(db, "groups"), where("inviteCode", "==", candidate), limit(1)));
      if (dupSnap.empty) {
        inviteCode = candidate;
        break;
      }
    }

    if (!inviteCode) {
      alert("그룹 코드 생성에 실패했습니다. 다시 시도해 주세요.");
      return;
    }

    const groupRef = doc(collection(db, "groups"));
    await setDoc(groupRef, {
      members: [user.uid],
      ownerUid: user.uid,
      mode: "private",
      status: "waiting",
      inviteCode,
      startedAt: null,
      closedAt: null,
      createdAt: serverTimestamp()
    });

    await setDoc(doc(db, "users", user.uid), {
      currentGroupId: groupRef.id,
      currentGroupInviteCode: inviteCode
    }, { merge: true });

    myInviteCodePill.style.display = "inline-flex";
    myInviteCodePill.textContent = "내 그룹 코드: " + inviteCode;
    alert("개인 그룹이 생성되었습니다. 코드: " + inviteCode);
  } catch (err) {
    console.error("createPrivateGroup failed", err);
    alert("개인 그룹 생성 중 오류가 발생했습니다.");
  } finally {
    createPrivateGroupBtn.disabled = false;
    joinPrivateGroupBtn.disabled = false;
  }
};

joinPrivateGroupBtn.onclick = async () => {
  const user = auth.currentUser;
  if (!user) return;

  createPrivateGroupBtn.disabled = true;
  joinPrivateGroupBtn.disabled = true;
  try {
    const nickname = await ensureNickname(user);
    if (!nickname) return;

    const code = normalizeInviteCode(inviteCodeInput.value);
    if (!code || code.length < 4) {
      alert("올바른 그룹 코드를 입력해 주세요.");
      return;
    }

    const gSnap = await getDocs(query(collection(db, "groups"), where("inviteCode", "==", code), limit(1)));
    if (gSnap.empty) {
      alert("해당 그룹 코드를 찾을 수 없습니다.");
      return;
    }

    const groupRef = gSnap.docs[0].ref;

    await runTransaction(db, async (tx) => {
      const userRef = doc(db, "users", user.uid);
      const userSnap = await tx.get(userRef);
      if (userSnap.exists() && userSnap.data().currentGroupId) {
        throw new Error("ALREADY_IN_GROUP");
      }

      const groupSnap = await tx.get(groupRef);
      if (!groupSnap.exists()) {
        throw new Error("GROUP_NOT_FOUND");
      }

      const groupData = groupSnap.data();
      const members = Array.isArray(groupData.members) ? groupData.members : [];
      const status = groupData.status || "waiting";

      if (status !== "waiting") {
        throw new Error("GROUP_NOT_JOINABLE");
      }

      if (!members.includes(user.uid) && members.length >= 5) {
        throw new Error("GROUP_FULL");
      }

      const nextMembers = members.includes(user.uid) ? members : [...members, user.uid];
      tx.update(groupRef, { members: nextMembers });
      tx.set(userRef, { currentGroupId: groupRef.id, currentGroupInviteCode: code }, { merge: true });
    });

    alert("개인 그룹에 입장했습니다.");
  } catch (err) {
    if (err && err.message === "ALREADY_IN_GROUP") {
      alert("이미 참여 중인 그룹이 있습니다.");
    } else if (err && err.message === "GROUP_FULL") {
      alert("해당 그룹은 정원이 가득 찼습니다.");
    } else if (err && err.message === "GROUP_NOT_FOUND") {
      alert("그룹을 찾을 수 없습니다.");
    } else if (err && err.message === "GROUP_NOT_JOINABLE") {
      alert("이미 시작되었거나 종료된 방입니다.");
    } else {
      console.error("joinPrivateGroup failed", err);
      alert("코드 입장 중 오류가 발생했습니다.");
    }
  } finally {
    createPrivateGroupBtn.disabled = false;
    joinPrivateGroupBtn.disabled = false;
  }
};

async function tryMatchGroup() {
  let created = false;
  const qRef = query(collection(db, "queue"), limit(10));
  const qSnap = await getDocs(qRef);

  if (qSnap.size < 2) {
    return false;
  }

  const candidateUids = qSnap.docs.map((d) => d.id);

  await runTransaction(db, async (tx) => {
    const waiting = [];

    for (const uid of candidateUids) {
      const queueRef = doc(db, "queue", uid);
      const queueSnap = await tx.get(queueRef);
      if (!queueSnap.exists()) continue;

      const userRef = doc(db, "users", uid);
      const userSnap = await tx.get(userRef);
      const alreadyGrouped = userSnap.exists() && userSnap.data().currentGroupId;

      if (!alreadyGrouped) {
        waiting.push(uid);
      }

      if (waiting.length >= 5) break;
    }

    if (waiting.length < 2) return;

    const groupSize = waiting.length >= 5 ? 5 : waiting.length;
    const members = waiting.slice(0, groupSize);

    const groupRef = doc(collection(db, "groups"));
    tx.set(groupRef, {
      members,
      ownerUid: members[0],
      mode: "random",
      status: "active",
      inviteCode: null,
      startedAt: serverTimestamp(),
      closedAt: null,
      createdAt: serverTimestamp()
    });

    for (const uid of members) {
      tx.set(doc(db, "users", uid), { currentGroupId: groupRef.id, currentGroupInviteCode: null }, { merge: true });
      tx.delete(doc(db, "queue", uid));
    }

    created = true;
  });

  if (created) {
    alert("그룹이 생성되었습니다.");
  }

  return created;
}

goGroupBtn.onclick = () => location.href = "/group.html";

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js");
}

});
