import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp, updateDoc, deleteDoc, runTransaction, onSnapshot, collection, addDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
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
  const storage = getStorage(app);
  const functions = getFunctions(app, "asia-northeast3");

  const statusEl = document.getElementById("status");
  const membersEl = document.getElementById("members");
  const fileInput = document.getElementById("fileInput");
  const checkinBtn = document.getElementById("checkinBtn");
  const ownerActionBtn = document.getElementById("ownerActionBtn");
  const ownerDissolveBtn = document.getElementById("ownerDissolveBtn");
  const leaveGroupBtn = document.getElementById("leaveGroupBtn");
  const backBtn = document.getElementById("backBtn");
  const goProfileBtn = document.getElementById("goProfileBtn");
  const photoModal = document.getElementById("photoModal");
  const photoViewer = document.getElementById("photoViewer");
  const photoBack = document.getElementById("photoBack");

  if (photoBack) photoBack.onclick = () => { photoModal.style.display = "none"; };
  if (backBtn) backBtn.onclick = () => { location.href = "/"; };
  if (goProfileBtn) goProfileBtn.onclick = () => { location.href = "/profile.html"; };

  let currentUser = null;
  let currentGroupId = null;
  const requestedGroupId = new URLSearchParams(location.search).get("groupId") || null;
  let groupUnsub = null;
  let userUnsub = null;
  const memberWatchers = new Map();
  const memberUserCache = new Map();
  const memberCheckinCache = new Map();
  const memberStatsCache = new Map();
  let latestUserData = null;
  let latestGroupData = null;

  let renderTimer = null;
  let rendering = false;
  let renderQueued = false;
  let todayKey = "";
  let checkinActionBusy = false;
  let restrictionHandled = false;

  function normalizeJoinedGroupIds(userData = {}) {
    const raw = Array.isArray(userData?.joinedGroupIds) ? userData.joinedGroupIds : [];
    const out = [];
    for (const gid of raw) {
      if (typeof gid !== "string" || !gid.trim()) continue;
      if (!out.includes(gid)) out.push(gid);
    }
    const current = typeof userData?.currentGroupId === "string" ? userData.currentGroupId : "";
    if (current && !out.includes(current)) out.push(current);
    return out;
  }

  function isRestrictedUser(data = {}) {
    if (data?.banned === true || data?.moderationStatus === "banned") return true;
    const until = data?.suspendedUntil;
    const untilMs = typeof until?.toMillis === "function" ? until.toMillis() : (until ? new Date(until).getTime() : 0);
    return Number.isFinite(untilMs) && untilMs > Date.now();
  }

  function restrictedMessage(data = {}) {
    if (data?.banned === true || data?.moderationStatus === "banned") return "운영자에 의해 계정이 차단되었습니다.";
    return "계정이 일시 정지 상태입니다.";
  }

  function extractFunctionErrorMessage(err, fallback) {
    if (err?.details && typeof err.details === "string") return err.details;
    if (err?.message && typeof err.message === "string") return err.message;
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
        page: "group",
        extra,
        createdAt: serverTimestamp()
      });
    } catch (_) {
      // no-op
    }
  }

  function todayStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function startDateWatcher() {
    todayKey = todayStr();
    setInterval(() => {
      const next = todayStr();
      if (next === todayKey) return;
      todayKey = next;
      // Date key changed at local 00:00: rebind today's checkin listeners.
      cleanupMemberWatchers();
      scheduleRender();
    }, 1000);
  }

  function cleanupMemberWatchers() {
    for (const unsubs of memberWatchers.values()) {
      for (const unsub of unsubs) unsub();
    }
    memberWatchers.clear();
    memberUserCache.clear();
    memberCheckinCache.clear();
    memberStatsCache.clear();
  }

  function setGroupWatcher(groupId) {
    if (groupUnsub) {
      groupUnsub();
      groupUnsub = null;
    }
    cleanupMemberWatchers();
    groupUnsub = onSnapshot(doc(db, "groups", groupId), (snap) => {
      latestGroupData = snap.exists() ? snap.data() : null;
      scheduleRender();
    });
  }

  function syncMemberWatchers(groupId, members) {
    const wanted = new Set(members);

    for (const uid of wanted) {
      if (memberWatchers.has(uid)) continue;
      const checkinDocId = `${groupId}_${uid}_${todayStr()}`;
      const unsubUser = onSnapshot(doc(db, "users", uid), (snap) => {
        memberUserCache.set(uid, snap.exists() ? snap.data() : null);
        scheduleRender();
      });
      const unsubCheckin = onSnapshot(doc(db, "checkins", checkinDocId), (snap) => {
        memberCheckinCache.set(uid, snap.exists() ? snap.data() : null);
        scheduleRender();
      });
      const statsDocId = `${groupId}_${uid}`;
      const unsubStats = onSnapshot(doc(db, "groupMemberStats", statsDocId), (snap) => {
        memberStatsCache.set(uid, snap.exists() ? snap.data() : null);
        scheduleRender();
      });
      memberWatchers.set(uid, [unsubUser, unsubCheckin, unsubStats]);
    }

    for (const [uid, unsubs] of memberWatchers.entries()) {
      if (wanted.has(uid)) continue;
      for (const unsub of unsubs) unsub();
      memberWatchers.delete(uid);
      memberUserCache.delete(uid);
      memberCheckinCache.delete(uid);
      memberStatsCache.delete(uid);
    }
  }

  function scheduleRender() {
    if (rendering) {
      renderQueued = true;
      return;
    }
    if (renderTimer) return;
    renderTimer = setTimeout(async () => {
      renderTimer = null;
      await renderGroup();
    }, 80);
  }

  async function renderGroup() {
    if (!currentUser || !currentGroupId) return;
    if (rendering) {
      renderQueued = true;
      return;
    }

    rendering = true;

    try {
      const userRef = doc(db, "users", currentUser.uid);
      let userData = latestUserData;
      if (!userData) {
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          await setDoc(userRef, {
            uid: currentUser.uid,
            name: currentUser.displayName || "",
            email: currentUser.email || "",
          nickname: currentUser.displayName || "사용자",
          currentChallengeStreak: 0,
          lastChallengeStreak: 0,
          isAdFree: false,
          adFreePurchasedAt: null,
          plan: "free",
          joinedGroupIds: [],
          currentGroupId: null,
          currentGroupInviteCode: null,
          createdAt: serverTimestamp()
          });
          latestUserData = {
            uid: currentUser.uid,
            name: currentUser.displayName || "",
            email: currentUser.email || "",
            nickname: currentUser.displayName || "사용자",
            currentChallengeStreak: 0,
            lastChallengeStreak: 0,
            currentGroupId: null,
            currentGroupInviteCode: null
          };
        } else {
          latestUserData = userSnap.data();
        }
        userData = latestUserData;
      }

      const joined = normalizeJoinedGroupIds(userData);
      if (!joined.length) {
        statusEl.textContent = "현재 참여 중인 그룹이 없습니다.";
        location.href = "/";
        return;
      }

      if (!currentGroupId || !joined.includes(currentGroupId)) {
        if (requestedGroupId && joined.includes(requestedGroupId)) {
          currentGroupId = requestedGroupId;
        } else if (userData.currentGroupId && joined.includes(userData.currentGroupId)) {
          currentGroupId = userData.currentGroupId;
        } else {
          currentGroupId = joined[0];
        }
        setGroupWatcher(currentGroupId);
      }

      const groupRef = doc(db, "groups", currentGroupId);
      let groupData = latestGroupData;
      if (!groupData) {
        const groupSnap = await getDoc(groupRef);
        groupData = groupSnap.exists() ? groupSnap.data() : null;
        latestGroupData = groupData;
      }

      if (!groupData) {
        statusEl.textContent = "그룹 정보를 찾을 수 없습니다.";
        await setDoc(userRef, {
          currentGroupId: null,
          currentGroupInviteCode: null,
          lastChallengeStreak: userData.currentChallengeStreak || 0,
          currentChallengeStreak: 0
        });
        location.href = "/";
        return;
      }
      const members = Array.isArray(groupData.members) ? groupData.members : [];
      const dissolveVotes = Array.isArray(groupData.dissolveVotes) ? groupData.dissolveVotes : [];
      const normalizedMode = groupData.mode || (groupData.inviteCode ? "private" : "random");
      const normalizedOwnerUid = groupData.ownerUid || (members.length > 0 ? members[0] : null);
      const normalizedStatus = groupData.status || (normalizedMode === "random" ? "active" : "waiting");
      const isOwner = normalizedOwnerUid === currentUser.uid;
      const isPairRoom = members.length === 2;
      const defaultDissolveRequired = Math.floor(members.length / 2) + 1;
      const dissolveVoteRequired = isPairRoom
        ? 1
        : (groupData.dissolveVoteRequired || defaultDissolveRequired);
      const reviewRequired = (members.length === 2 && isOwner) ? 1 : Math.min(2, members.length);
      const isManagedRoom = normalizedMode !== "random";
      const groupStatus = normalizedStatus;
      const challengeLocked = isManagedRoom && groupStatus !== "active";

      syncMemberWatchers(currentGroupId, members);

      membersEl.innerHTML = "";
      const today = todayStr();

      const memberElements = [];

      for (const uid of members) {
        const m = memberUserCache.get(uid) || null;
        const s = memberStatsCache.get(uid) || null;
        const checkin = memberCheckinCache.get(uid) || null;
        const nickname = m?.nickname || m?.name || "사용자";
        const streak = Number(s?.currentStreak || 0);
        const isMe = uid === currentUser.uid;

        let imageURL = null;
        let checkinStatus = null;
        if (checkin) {
          imageURL = checkin.imageURL;
          checkinStatus = checkin.status || "approved";
        }

        let markClass = "wait";
        let markText = "⏳ 인증 대기";

        const now = new Date();
        const deadline = new Date();
        deadline.setHours(23, 59, 59, 999);

        if (checkin && checkinStatus === "approved") {
          markClass = "ok";
          markText = "⭕ 인증 완료";
        } else if (checkin && checkinStatus === "pending") {
          const approvals = Array.isArray(checkin?.approvals) ? checkin.approvals.length : 0;
          const rejections = Array.isArray(checkin?.rejections) ? checkin.rejections.length : 0;
          markClass = "wait";
          markText = `🟡 검토중 (${approvals}/${reviewRequired}, 반려 ${rejections}/${reviewRequired})`;
        } else if (checkin && checkinStatus === "rejected") {
          markClass = "no";
          markText = "❌ 반려";
        } else if (now > deadline) {
          markClass = "no";
          markText = "❌ 미인증";
        }

        const li = document.createElement("li");
        li.className = "item";
        li.innerHTML =
          '<div class="item-left">' +
          '<div class="item-name">' + nickname + '</div>' +
          '<div class="item-sub">' + (isMe ? "본인" : "그룹원") + '</div>' +
          '<div class="item-streak">🔥 ' + streak + '일 연속</div>' +
          "</div>" +
          '<div class="badge ' + markClass + '">' + markText + "</div>";

        if (!isMe) {
          const nameEl = li.querySelector(".item-name");
          if (nameEl) {
            nameEl.style.display = "flex";
            nameEl.style.alignItems = "center";
            nameEl.style.gap = "6px";

            const reportBtn = document.createElement("button");
            reportBtn.className = "btn compact ghost";
            reportBtn.style.padding = "2px 8px";
            reportBtn.style.fontSize = "12px";
            reportBtn.textContent = "신고";

            const blockBtn = document.createElement("button");
            blockBtn.className = "btn compact ghost";
            blockBtn.style.padding = "2px 8px";
            blockBtn.style.fontSize = "12px";
            blockBtn.textContent = "차단";

            reportBtn.onclick = async (e) => {
              e.stopPropagation();
              const reason = (prompt("신고 사유를 입력해 주세요. (최대 500자)") || "").trim();
              if (!reason) return;
              const blockAlso = confirm("동시에 이 사용자를 차단할까요?");
              reportBtn.disabled = true;
              blockBtn.disabled = true;
              try {
                const reportFn = httpsCallable(functions, "reportUser");
                await reportFn({
                  groupId: currentGroupId,
                  targetUid: uid,
                  reason,
                  blockAlso
                });
                alert(blockAlso ? "신고 및 차단이 완료되었습니다." : "신고가 접수되었습니다.");
              } catch (err) {
                console.error("reportUser failed", err);
                await logClientError("reportUser_failed", err, { groupId: currentGroupId, targetUid: uid });
                alert(extractFunctionErrorMessage(err, "신고 처리 중 오류가 발생했습니다."));
              } finally {
                reportBtn.disabled = false;
                blockBtn.disabled = false;
              }
            };

            blockBtn.onclick = async (e) => {
              e.stopPropagation();
              if (!confirm("이 사용자를 차단할까요?")) return;
              reportBtn.disabled = true;
              blockBtn.disabled = true;
              try {
                const blockFn = httpsCallable(functions, "blockUser");
                await blockFn({ targetUid: uid });
                alert("차단되었습니다. 이후 같은 방 입장이 제한됩니다.");
              } catch (err) {
                console.error("blockUser failed", err);
                await logClientError("blockUser_failed", err, { groupId: currentGroupId, targetUid: uid });
                alert(extractFunctionErrorMessage(err, "차단 처리 중 오류가 발생했습니다."));
              } finally {
                reportBtn.disabled = false;
                blockBtn.disabled = false;
              }
            };

            nameEl.appendChild(reportBtn);
            nameEl.appendChild(blockBtn);
          }
        }

        if (imageURL) {
          li.style.cursor = "pointer";
          li.onclick = () => {
            photoViewer.src = imageURL;
            photoModal.style.display = "flex";
          };
        }

        if (checkin && checkinStatus !== "approved") {
          const actions = document.createElement("div");
          actions.style.display = "flex";
          actions.style.gap = "6px";
          actions.style.marginTop = "8px";

          const approveBtn = document.createElement("button");
          approveBtn.className = "btn compact";
          approveBtn.textContent = "승인";
          approveBtn.onclick = async (e) => {
            e.stopPropagation();
            approveBtn.disabled = true;
            rejectBtn.disabled = true;
            try {
              const approveFn = httpsCallable(functions, "approveCheckin");
              const res = await approveFn({ groupId: currentGroupId, targetUid: uid, date: today });
              if (res?.data?.approved) {
                alert("승인이 확정되었습니다.");
              }
            } catch (err) {
              console.error("approveCheckin failed", err);
              await logClientError("approveCheckin_failed", err, { groupId: currentGroupId, targetUid: uid, date: today });
              alert(extractFunctionErrorMessage(err, "승인 처리 중 오류가 발생했습니다."));
            } finally {
              approveBtn.disabled = false;
              rejectBtn.disabled = false;
            }
          };

          const rejectBtn = document.createElement("button");
          rejectBtn.className = "btn compact ghost";
          rejectBtn.textContent = "반려";
          rejectBtn.onclick = async (e) => {
            e.stopPropagation();
            approveBtn.disabled = true;
            rejectBtn.disabled = true;
            try {
              const rejectFn = httpsCallable(functions, "rejectCheckin");
              const res = await rejectFn({ groupId: currentGroupId, targetUid: uid, date: today });
              if (res?.data?.rejected) {
                alert("반려가 확정되었습니다.");
              }
            } catch (err) {
              console.error("rejectCheckin failed", err);
              await logClientError("rejectCheckin_failed", err, { groupId: currentGroupId, targetUid: uid, date: today });
              alert(extractFunctionErrorMessage(err, "반려 처리 중 오류가 발생했습니다."));
            } finally {
              approveBtn.disabled = false;
              rejectBtn.disabled = false;
            }
          };

          actions.appendChild(approveBtn);
          actions.appendChild(rejectBtn);
          li.querySelector(".item-left")?.appendChild(actions);
        }

        const priority = markClass === "no" ? 0 : markClass === "wait" ? 1 : 2;
        memberElements.push({ element: li, priority });
      }

      memberElements
        .sort((a, b) => a.priority - b.priority)
        .forEach((m) => membersEl.appendChild(m.element));

      const groupTitle = (groupData.title || "").trim();
      let statusText = "그룹 ID : " + currentGroupId;
      if (groupTitle) {
        statusText += ` · 이름: ${groupTitle}`;
      }
      if (isManagedRoom) {
        if (groupStatus === "waiting") {
          statusText += " · 대기실 (" + members.length + "/5)";
        } else if (groupStatus === "active") {
          statusText += " · 진행 중";
        } else {
          statusText += " · 종료됨";
        }
        if (!isPairRoom && (groupStatus === "waiting" || groupStatus === "active") && dissolveVotes.length > 0) {
          statusText += ` · 해산 투표 ${dissolveVotes.length}/${dissolveVoteRequired}`;
        }
      }
      statusEl.textContent = statusText;

      if (ownerActionBtn) {
        ownerActionBtn.style.display = "none";
        ownerActionBtn.onclick = null;

        if (isManagedRoom && isOwner && groupStatus === "waiting") {
          ownerActionBtn.style.display = "block";
          ownerActionBtn.textContent = members.length >= 2 ? "챌린지 시작" : "챌린지 시작 (2명 이상)";
          ownerActionBtn.disabled = members.length < 2;

          ownerActionBtn.onclick = async () => {
            if (!confirm("현재 멤버로 챌린지를 시작할까요?")) return;

            try {
              await runTransaction(db, async (tx) => {
                const latest = await tx.get(groupRef);
                if (!latest.exists()) throw new Error("GROUP_NOT_FOUND");

                const d = latest.data();
                const latestMembers = Array.isArray(d.members) ? d.members : [];
                const mode = d.mode || (d.inviteCode ? "private" : "random");
                const ownerUid = d.ownerUid || (latestMembers.length > 0 ? latestMembers[0] : null);
                const status = d.status || (mode === "random" ? "active" : "waiting");

                const canStart =
                  mode !== "random" &&
                  ownerUid === currentUser.uid &&
                  status === "waiting" &&
                  latestMembers.length >= 2 &&
                  latestMembers.length <= 5;

                if (!canStart) throw new Error("NOT_STARTABLE");

                tx.update(groupRef, {
                  status: "active",
                  startedAt: serverTimestamp()
                });
              });

              alert("챌린지가 시작되었습니다.");
            } catch (err) {
              if (err && err.message === "NOT_STARTABLE") {
                alert("현재 상태에서는 시작할 수 없습니다.");
              } else {
                console.error("startChallenge failed", err);
                alert("챌린지 시작 중 오류가 발생했습니다.");
              }
            }
          };
        }
      }

      if (ownerDissolveBtn) {
        ownerDissolveBtn.style.display = "none";
        ownerDissolveBtn.onclick = null;

        const canShowDissolve = isManagedRoom
          && (groupStatus === "waiting" || groupStatus === "active")
          && (!isPairRoom || isOwner);

        if (canShowDissolve) {
          ownerDissolveBtn.style.display = "block";
          ownerDissolveBtn.textContent = isPairRoom
            ? "방 해산"
            : `방 해산 투표 (${dissolveVotes.length}/${dissolveVoteRequired})`;

          ownerDissolveBtn.onclick = async () => {
            if (!confirm(isPairRoom
              ? "2인 방은 즉시 해산됩니다. 진행할까요?"
              : "해산 투표를 진행할까요? 과반 동의 시 방이 해산됩니다."
            )) return;

            try {
              const dissolveRoomFn = httpsCallable(functions, "dissolveRoom");
              const res = await dissolveRoomFn({ groupId: currentGroupId });
              const data = res?.data || {};
              if (data.dissolved) {
                alert(isPairRoom ? "방이 해산되었습니다." : "과반 동의로 방이 해산되었습니다.");
                location.href = "/";
              } else {
                alert(`해산 투표가 반영되었습니다. (${data.votes || 0}/${data.required || dissolveVoteRequired})`);
              }
            } catch (err) {
              console.error("dissolveRoom failed", err);
              await logClientError("dissolveRoom_failed", err, { groupId: currentGroupId });
              const msg = typeof err?.details === "string"
                ? err.details
                : "방 해산 중 오류가 발생했습니다.";
              alert(msg);
            }
          };
        }
      }

      if (checkinBtn) {
        const date = todayStr();
        const todayCheckinRef = doc(db, "checkins", `${currentGroupId}_${currentUser.uid}_${date}`);
        const storageRef = ref(storage, `checkins/${currentGroupId}/${currentUser.uid}_${date}.jpg`);
        const myTodayData = memberCheckinCache.get(currentUser.uid) || null;
        const hasMyTodayCheckin = !!myTodayData;
        const myTodayStatus = hasMyTodayCheckin ? (myTodayData.status || "approved") : null;
        const fileBox = fileInput ? fileInput.closest(".file") : null;

        if (challengeLocked) {
          checkinBtn.textContent = groupStatus === "closed" ? "종료된 방입니다" : "대기실: 방장 시작 대기";
          checkinBtn.disabled = true;
          if (fileInput) fileInput.disabled = true;
          if (fileBox) fileBox.style.opacity = "0.6";
        } else {
          checkinBtn.disabled = false;
          if (fileInput) fileInput.disabled = false;
          if (fileBox) fileBox.style.opacity = "1";
        }

        if (!challengeLocked && hasMyTodayCheckin) {
          checkinBtn.textContent = myTodayStatus === "approved"
            ? "승인됨 · 사진 변경/삭제"
            : (myTodayStatus === "rejected" ? "반려됨 · 사진 변경/삭제" : "검토중 · 사진 변경/삭제");
          checkinBtn.onclick = async () => {
            if (checkinActionBusy) return;
            checkinActionBusy = true;
            const willChange = confirm("확인을 누르면 사진 변경, 취소를 누르면 삭제 선택으로 이동합니다.");
            checkinBtn.disabled = true;
            checkinBtn.textContent = "처리중...";

            try {
              if (willChange) {
                if (!fileInput || !fileInput.files[0]) {
                  alert("변경할 사진을 먼저 선택해 주세요.");
                  return;
                }

                const file = fileInput.files[0];
                await uploadBytes(storageRef, file);
                const imageURL = await getDownloadURL(storageRef);

              await updateDoc(todayCheckinRef, {
                imageURL,
                updatedAt: serverTimestamp(),
                status: "pending",
                  reviewedBy: null,
                  reviewedAt: null,
                  streakCounted: false
              });

              if (myTodayData?.streakCounted) {
                const statsRef = doc(db, "groupMemberStats", `${currentGroupId}_${currentUser.uid}`);
                const statsSnap = await getDoc(statsRef);
                const currentStreak = statsSnap.exists() ? Number(statsSnap.data()?.currentStreak || 0) : 0;
                await setDoc(statsRef, {
                  groupId: currentGroupId,
                  uid: currentUser.uid,
                  currentStreak: Math.max(currentStreak - 1, 0),
                  updatedAt: serverTimestamp()
                }, { merge: true });
              }

                alert("오늘 인증 사진이 재제출되었습니다. 방장 승인 후 반영됩니다.");
                return;
              }

              const willDelete = confirm("오늘 인증을 취소(삭제)하시겠습니까?");
              if (!willDelete) return;

              try {
                await deleteObject(storageRef);
              } catch (_) {
                // no-op
              }

              await deleteDoc(todayCheckinRef);

              if (myTodayData?.streakCounted) {
                const statsRef = doc(db, "groupMemberStats", `${currentGroupId}_${currentUser.uid}`);
                const statsSnap = await getDoc(statsRef);
                const currentStreak = statsSnap.exists() ? Number(statsSnap.data()?.currentStreak || 0) : 0;
                await setDoc(statsRef, {
                  groupId: currentGroupId,
                  uid: currentUser.uid,
                  currentStreak: Math.max(currentStreak - 1, 0),
                  updatedAt: serverTimestamp()
                }, { merge: true });
              }

              alert("오늘 인증이 취소되었습니다.");
            } catch (err) {
              console.error("checkin change/delete failed", err);
              await logClientError("checkin_change_delete_failed", err, { groupId: currentGroupId, date });
              alert("인증 처리 중 오류가 발생했습니다.");
            } finally {
              checkinBtn.disabled = false;
              checkinActionBusy = false;
              scheduleRender();
            }
          };
        } else if (!challengeLocked) {
          checkinBtn.textContent = "오늘 인증 제출";
          checkinBtn.onclick = async () => {
            if (checkinActionBusy) return;
            checkinActionBusy = true;
            if (!fileInput || !fileInput.files[0]) {
              alert("먼저 인증 사진을 선택해 주세요.");
              checkinActionBusy = false;
              return;
            }

            const file = fileInput.files[0];
            if (hasMyTodayCheckin) {
              alert("오늘은 이미 인증이 완료되었습니다.");
              checkinActionBusy = false;
              return;
            }

            checkinBtn.disabled = true;
            checkinBtn.textContent = "업로드 중...";
            try {
              await uploadBytes(storageRef, file);
              const imageURL = await getDownloadURL(storageRef);

              await setDoc(todayCheckinRef, {
                groupId: currentGroupId,
                uid: currentUser.uid,
                date,
                imageURL,
                createdAt: serverTimestamp(),
                status: "pending",
                reviewedBy: null,
                reviewedAt: null,
                streakCounted: false,
                approvals: [],
                rejections: []
              });
              alert("오늘 인증이 제출되었습니다. 방장 승인 후 연속일이 반영됩니다.");
            } catch (err) {
              console.error("checkin submit failed", err);
              await logClientError("checkin_submit_failed", err, { groupId: currentGroupId, date });
              alert("인증 업로드 중 오류가 발생했습니다.");
            } finally {
              checkinBtn.disabled = false;
              checkinActionBusy = false;
              scheduleRender();
            }
          };
        }
      }

      if (leaveGroupBtn) {
        leaveGroupBtn.textContent = isOwner && isManagedRoom ? "방 나가기(방장)" : "그룹 나가기";
        leaveGroupBtn.onclick = async () => {
          if (!confirm("정말로 그룹에서 나가시겠습니까?")) return;

          try {
            const leaveGroupFn = httpsCallable(functions, "leaveGroup");
            const result = await leaveGroupFn({ groupId: currentGroupId });
            const dissolved = !!result?.data?.dissolved;
            alert(dissolved ? "마지막 멤버가 나가 방이 자동으로 삭제되었습니다." : "그룹에서 나가셨습니다.");
          } catch (err) {
            console.error("leaveGroup failed", err);
            await logClientError("leaveGroup_failed", err, { groupId: currentGroupId });
            alert("그룹 나가기 중 오류가 발생했습니다.");
            return;
          }

          location.href = "/";
        };
      }
    } catch (err) {
      console.error("renderGroup failed", err);
    } finally {
      rendering = false;
      if (renderQueued) {
        renderQueued = false;
        scheduleRender();
      }
    }
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      restrictionHandled = false;
      location.href = "/";
      return;
    }

    currentUser = user;
    const userRef = doc(db, "users", user.uid);
    let userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        name: user.displayName || "",
        email: user.email || "",
        nickname: user.displayName || "사용자",
        currentChallengeStreak: 0,
        lastChallengeStreak: 0,
        isAdFree: false,
        adFreePurchasedAt: null,
        plan: "free",
        joinedGroupIds: [],
        currentGroupId: null,
        currentGroupInviteCode: null,
        createdAt: serverTimestamp()
      });
      userSnap = await getDoc(userRef);
    }

    const myData = userSnap.data();
    if (isRestrictedUser(myData)) {
      if (!restrictionHandled) {
        restrictionHandled = true;
        alert(restrictedMessage(myData));
      }
      await signOut(auth);
      return;
    }
    const joined = normalizeJoinedGroupIds(myData);
    if (!joined.length) {
      statusEl.textContent = "현재 참여 중인 그룹이 없습니다.";
      return;
    }
    latestUserData = myData;
    if (requestedGroupId && joined.includes(requestedGroupId)) {
      currentGroupId = requestedGroupId;
    } else if (myData.currentGroupId && joined.includes(myData.currentGroupId)) {
      currentGroupId = myData.currentGroupId;
    } else {
      currentGroupId = joined[0];
    }

    if (userUnsub) userUnsub();
    userUnsub = onSnapshot(userRef, (snap) => {
      if (!snap.exists()) return;
      const latest = snap.data();
      if (isRestrictedUser(latest)) {
        if (!restrictionHandled) {
          restrictionHandled = true;
          alert(restrictedMessage(latest));
        }
        signOut(auth);
        return;
      }
      latestUserData = latest;
      const latestJoined = normalizeJoinedGroupIds(latest);
      if (!latestJoined.length) {
        location.href = "/";
        return;
      }
      if (!latestJoined.includes(currentGroupId)) {
        if (requestedGroupId && latestJoined.includes(requestedGroupId)) {
          currentGroupId = requestedGroupId;
        } else if (latest.currentGroupId && latestJoined.includes(latest.currentGroupId)) {
          currentGroupId = latest.currentGroupId;
        } else {
          currentGroupId = latestJoined[0];
        }
        setGroupWatcher(currentGroupId);
      }
      scheduleRender();
    });

    setGroupWatcher(currentGroupId);
    scheduleRender();
  });

  startDateWatcher();
});
