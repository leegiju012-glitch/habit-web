import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc, serverTimestamp, getDoc, collection, getDocs, deleteDoc, addDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
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

loginBtn.onclick = () => signInWithPopup(auth, provider);
logoutBtn.onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {

  if (!user) {
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

  if (myData.currentGroupId) {
    goGroupBtn.style.display = "block";
    joinQueueBtn.style.display = "none";
  } else {
    goGroupBtn.style.display = "none";
    joinQueueBtn.style.display = "block";
  }
});

joinQueueBtn.onclick = async () => {
  const user = auth.currentUser;
  if (!user) return;

  await setDoc(doc(db, "queue", user.uid), {
    uid: user.uid,
    createdAt: serverTimestamp()
  }, { merge: true });

  alert("매칭 대기열에 등록되었습니다.");
  await tryMatchGroup();
};

async function tryMatchGroup() {
  const qSnap = await getDocs(collection(db, "queue"));
  const users = [];
  qSnap.forEach(d => users.push(d.data()));

  if (users.length < 3) return;

  const members = users.slice(0, 3).map(u => u.uid);

  const groupRef = await addDoc(collection(db, "groups"), {
    members,
    createdAt: serverTimestamp()
  });

  for (const uid of members) {
    await setDoc(doc(db, "users", uid), { currentGroupId: groupRef.id }, { merge: true });
    await deleteDoc(doc(db, "queue", uid));
  }

  alert("그룹이 생성되었습니다.");
}

goGroupBtn.onclick = () => location.href = "/group.html";

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js");
}

});