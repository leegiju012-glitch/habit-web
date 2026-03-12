import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

  const backLobbyBtn = document.getElementById("backLobbyBtn");
  const goGroupBtn = document.getElementById("goGroupBtn");
  const goAdminBtn = document.getElementById("goAdminBtn");
  const userName = document.getElementById("userName");
  const userMail = document.getElementById("userMail");
  const avatarBox = document.getElementById("avatarBox");
  const nicknameInput = document.getElementById("nicknameInput");
  const saveNickBtn = document.getElementById("saveNickBtn");
  const streakNow = document.getElementById("streakNow");
  const streakLast = document.getElementById("streakLast");
  const groupStatus = document.getElementById("groupStatus");

  let userDocUnsub = null;
  const ADMIN_EMAILS = ["leegiju012@gmail.com"];

  backLobbyBtn.onclick = () => { location.href = "/index.html"; };
  goGroupBtn.onclick = () => { location.href = "/group.html"; };
  if (goAdminBtn) {
    goAdminBtn.onclick = () => { location.href = "/admin.html"; };
  }

  function isValidNickname(value) {
    const nickname = (value || "").trim();
    return nickname.length >= 2 && nickname.length <= 10;
  }

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

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      location.href = "/";
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

    if (userDocUnsub) userDocUnsub();
    userDocUnsub = onSnapshot(userRef, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      const email = (user.email || "").trim().toLowerCase();
      const isAdmin = !!data.isAdmin || ADMIN_EMAILS.includes(email);

      userName.textContent = data.nickname || user.displayName || "사용자";
      userMail.textContent = user.email || "";
      nicknameInput.value = data.nickname || "";
      streakNow.textContent = `현재 챌린지 연속: ${data.currentChallengeStreak || 0}일`;
      streakLast.textContent = `이전 챌린지 기록: ${data.lastChallengeStreak || 0}일`;
      groupStatus.textContent = data.currentGroupId
        ? `현재 참여 방: ${data.currentGroupId}`
        : "현재 참여 방: 없음";
      goGroupBtn.style.display = data.currentGroupId ? "inline-flex" : "none";
      if (goAdminBtn) goAdminBtn.style.display = isAdmin ? "inline-flex" : "none";
    });

    avatarBox.innerHTML = "";
    if (user.photoURL) {
      const img = document.createElement("img");
      img.src = user.photoURL;
      avatarBox.appendChild(img);
    }
  });
});
