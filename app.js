import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc, serverTimestamp, getDoc, getDocs, collection, query, limit, runTransaction, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
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
let userDocUnsub = null;

function renderGroupButtons(currentGroupId) {
  if (currentGroupId) {
    goGroupBtn.style.display = "block";
    joinQueueBtn.style.display = "none";
    return;
  }
  goGroupBtn.style.display = "none";
  joinQueueBtn.style.display = "block";
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
      email: user.email || "",
      photoURL: user.photoURL || "",
      currentGroupId: null,
      createdAt: serverTimestamp()
    });
    userSnap = await getDoc(userRef);
  }

  const myData = userSnap.data();

  loginBtn.style.display = "none";
  logoutBtn.style.display = "block";
  profileBox.style.display = "flex";
  statusPill.textContent = "온라인";

  userName.textContent = myData.nickname || user.displayName || "사용자";
  userMail.textContent = user.email || "";

  avatarBox.innerHTML = "";
  if (user.photoURL) {
    const img = document.createElement("img");
    img.src = user.photoURL;
    avatarBox.appendChild(img);
  }

  renderGroupButtons(myData.currentGroupId);

  if (userDocUnsub) {
    userDocUnsub();
  }

  userDocUnsub = onSnapshot(userRef, (snap) => {
    if (!snap.exists()) return;
    const latest = snap.data();
    renderGroupButtons(latest.currentGroupId);
  });
});

joinQueueBtn.onclick = async () => {
  const user = auth.currentUser;
  if (!user) return;

  try {
    joinQueueBtn.disabled = true;

    await setDoc(doc(db, "queue", user.uid), {
      uid: user.uid,
      createdAt: serverTimestamp()
    }, { merge: true });

    alert("매칭 대기열에 등록되었습니다.");
    const created = await tryMatchGroup();

    const latestUserSnap = await getDoc(doc(db, "users", user.uid));
    const latestGroupId = latestUserSnap.exists() ? latestUserSnap.data().currentGroupId : null;
    renderGroupButtons(latestGroupId);

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

async function tryMatchGroup() {
  let created = false;
  const qRef = query(collection(db, "queue"), limit(10));
  const qSnap = await getDocs(qRef);

  if (qSnap.size < 1) {
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

    if (waiting.length < 1) return;

    const groupSize = waiting.length >= 5 ? 5 : waiting.length;
    const members = waiting.slice(0, groupSize);

    const groupRef = doc(collection(db, "groups"));
    tx.set(groupRef, {
      members,
      createdAt: serverTimestamp()
    });

    for (const uid of members) {
      tx.set(doc(db, "users", uid), { currentGroupId: groupRef.id }, { merge: true });
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
