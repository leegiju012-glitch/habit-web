import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
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
  const toggleStatsBtn = document.getElementById("toggleStatsBtn");
  const toggleNicknameBtn = document.getElementById("toggleNicknameBtn");
  const statsPanel = document.getElementById("statsPanel");
  const nicknameBox = document.getElementById("nicknameBox");
  const statPlan = document.getElementById("statPlan");
  const statRooms = document.getElementById("statRooms");
  const stat7dRate = document.getElementById("stat7dRate");
  const proPerkHint = document.getElementById("proPerkHint");
  const adFreeStatus = document.getElementById("adFreeStatus");
  const openAdFreePayBtn = document.getElementById("openAdFreePayBtn");
  const openProPayBtn = document.getElementById("openProPayBtn");
  const purchaseActionPanel = document.getElementById("purchaseActionPanel");
  const purchaseTargetLabel = document.getElementById("purchaseTargetLabel");
  const purchaseProvider = document.getElementById("purchaseProvider");
  const purchaseReceiptInput = document.getElementById("purchaseReceiptInput");
  const buySelectedBtn = document.getElementById("buySelectedBtn");
  const restoreSelectedBtn = document.getElementById("restoreSelectedBtn");
  const closePurchasePanelBtn = document.getElementById("closePurchasePanelBtn");
  const proStatus = document.getElementById("proStatus");

  let userDocUnsub = null;
  let statsRequestId = 0;
  let selectedPurchaseProduct = null;
  const ADMIN_EMAILS = ["leegiju012@gmail.com"];

  backLobbyBtn.onclick = () => { location.href = "/index.html"; };
  goGroupBtn.onclick = () => { location.href = "/group.html"; };
  if (goAdminBtn) {
    goAdminBtn.onclick = () => { location.href = "/admin.html"; };
  }
  if (toggleStatsBtn) {
    toggleStatsBtn.onclick = () => {
      if (!statsPanel) return;
      const isOpen = statsPanel.style.display !== "none";
      statsPanel.style.display = isOpen ? "none" : "block";
    };
  }
  if (toggleNicknameBtn) {
    toggleNicknameBtn.onclick = () => {
      if (!nicknameBox) return;
      const isOpen = nicknameBox.style.display !== "none";
      nicknameBox.style.display = isOpen ? "none" : "flex";
    };
  }

  function isValidNickname(value) {
    const nickname = (value || "").trim();
    return nickname.length >= 2 && nickname.length <= 10;
  }

  function localDateStr(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  async function refreshProStats(user, data) {
    const requestId = ++statsRequestId;
    const plan = data?.plan === "pro" ? "pro" : "free";
    const joinedGroupIds = Array.isArray(data?.joinedGroupIds)
      ? data.joinedGroupIds.filter((gid) => typeof gid === "string" && gid)
      : (data?.currentGroupId ? [data.currentGroupId] : []);

    if (statPlan) statPlan.textContent = plan.toUpperCase();
    if (statRooms) statRooms.textContent = `${joinedGroupIds.length}/${plan === "pro" ? 5 : 1}`;

    if (proPerkHint) {
      proPerkHint.textContent = plan === "pro"
        ? "Pro 혜택 활성화됨: 방 최대 5개, 고급 통계, 광고 제거"
        : "Pro 혜택: 방 최대 5개, 고급 통계, 광고 제거";
    }

    if (!stat7dRate) return;
    if (plan !== "pro") {
      stat7dRate.textContent = "Pro 전용";
      return;
    }
    if (!data?.currentGroupId) {
      stat7dRate.textContent = "그룹 없음";
      return;
    }

    try {
      let approved = 0;
      for (let i = 0; i < 7; i++) {
        const date = localDateStr(-i);
        const checkinId = `${data.currentGroupId}_${user.uid}_${date}`;
        const snap = await getDoc(doc(db, "checkins", checkinId));
        if (snap.exists() && (snap.data()?.status || "") === "approved") {
          approved += 1;
        }
      }
      if (requestId !== statsRequestId) return;
      stat7dRate.textContent = `${Math.round((approved / 7) * 100)}%`;
    } catch (err) {
      console.error("refreshProStats failed", err);
      if (requestId !== statsRequestId) return;
      stat7dRate.textContent = "-";
    }
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

  function setPurchaseTarget(product) {
    selectedPurchaseProduct = product === "pro" ? "pro" : "adfree";
    if (purchaseActionPanel) purchaseActionPanel.style.display = "block";
    if (!purchaseTargetLabel || !buySelectedBtn || !restoreSelectedBtn) return;
    if (selectedPurchaseProduct === "pro") {
      purchaseTargetLabel.textContent = "Pro 이용권 결제";
      buySelectedBtn.textContent = "Pro 업그레이드";
      restoreSelectedBtn.textContent = "Pro 복원";
    } else {
      purchaseTargetLabel.textContent = "광고 제거 영구권 결제";
      buySelectedBtn.textContent = "광고 제거 구매";
      restoreSelectedBtn.textContent = "구매 복원";
    }
  }

  function setPurchaseButtonsDisabled(disabled) {
    if (buySelectedBtn) buySelectedBtn.disabled = disabled;
    if (restoreSelectedBtn) restoreSelectedBtn.disabled = disabled;
    if (openAdFreePayBtn) openAdFreePayBtn.disabled = disabled;
    if (openProPayBtn) openProPayBtn.disabled = disabled;
  }

  async function requestAdFreeVerification(mode = "buy") {
    const provider = (purchaseProvider?.value || "toss").trim();
    const receiptInput = (purchaseReceiptInput?.value || "").trim();
    const autoPrefix = provider === "apple" ? "APPLE_TEST_" : "TOSS_TEST_";
    const transactionId = receiptInput || `${autoPrefix}${Date.now()}`;
    const productId = "ad_free_lifetime_5500";
    const fnName = provider === "apple" ? "verifyApplePurchase" : "verifyTossPurchase";

    const call = httpsCallable(functions, fnName);
    const res = await call({
      productId,
      transactionId,
      receipt: receiptInput || transactionId
    });
    const granted = !!res?.data?.granted;
    alert(granted
      ? (mode === "restore" ? "복원이 완료되었습니다." : "구매가 반영되었습니다.")
      : "이미 처리된 결제입니다.");
  }

  async function requestProVerification(mode = "buy") {
    const provider = (purchaseProvider?.value || "toss").trim().toLowerCase();
    const receiptInput = (purchaseReceiptInput?.value || "").trim();
    const autoPrefix = provider === "apple" ? "APPLE_TEST_" : "TOSS_TEST_";
    const transactionId = receiptInput || `${autoPrefix}${Date.now()}_PRO`;
    const verifyPro = httpsCallable(functions, "verifyProSubscription");
    const res = await verifyPro({
      provider,
      transactionId,
      receipt: receiptInput || transactionId
    });
    const granted = !!res?.data?.granted;
    alert(granted
      ? (mode === "restore" ? "Pro 복원이 완료되었습니다." : "회원등급이 Pro로 업그레이드되었습니다.")
      : "이미 처리된 결제입니다.");
  }

  if (openAdFreePayBtn) openAdFreePayBtn.onclick = () => setPurchaseTarget("adfree");
  if (openProPayBtn) openProPayBtn.onclick = () => setPurchaseTarget("pro");

  if (closePurchasePanelBtn) {
    closePurchasePanelBtn.onclick = () => {
      if (purchaseActionPanel) purchaseActionPanel.style.display = "none";
      selectedPurchaseProduct = null;
    };
  }

  if (buySelectedBtn) {
    buySelectedBtn.onclick = async () => {
      if (!selectedPurchaseProduct) {
        alert("먼저 결제할 상품을 선택해 주세요.");
        return;
      }
      setPurchaseButtonsDisabled(true);
      try {
        if (selectedPurchaseProduct === "pro") {
          await requestProVerification("buy");
        } else {
          await requestAdFreeVerification("buy");
        }
      } catch (err) {
        console.error("buySelected failed", err);
        const fallback = selectedPurchaseProduct === "pro"
          ? "Pro 업그레이드 중 오류가 발생했습니다."
          : "구매 처리 중 오류가 발생했습니다.";
        alert(typeof err?.details === "string" ? err.details : fallback);
      } finally {
        setPurchaseButtonsDisabled(false);
      }
    };
  }

  if (restoreSelectedBtn) {
    restoreSelectedBtn.onclick = async () => {
      if (!selectedPurchaseProduct) {
        alert("먼저 복원할 상품을 선택해 주세요.");
        return;
      }
      setPurchaseButtonsDisabled(true);
      try {
        if (selectedPurchaseProduct === "pro") {
          await requestProVerification("restore");
        } else {
          await requestAdFreeVerification("restore");
        }
      } catch (err) {
        console.error("restoreSelected failed", err);
        const fallback = selectedPurchaseProduct === "pro"
          ? "Pro 복원 중 오류가 발생했습니다."
          : "복원 처리 중 오류가 발생했습니다.";
        alert(typeof err?.details === "string" ? err.details : fallback);
      } finally {
        setPurchaseButtonsDisabled(false);
      }
    };
  }

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
        isAdFree: false,
        adFreePurchasedAt: null,
        plan: "free",
        joinedGroupIds: [],
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
      if (adFreeStatus) {
        adFreeStatus.textContent = data.isAdFree
          ? "상태: 구매 완료(영구)"
          : "상태: 미구매";
      }
      if (proStatus) {
        proStatus.textContent = data.plan === "pro"
          ? "상태: Pro 이용 중"
          : "상태: Free";
      }
      refreshProStats(user, data);
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
