import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp, updateDoc, deleteDoc, runTransaction, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
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
  let groupUnsub = null;
  let userUnsub = null;
  const memberWatchers = new Map();

  let renderTimer = null;
  let rendering = false;
  let renderQueued = false;

  function extractFunctionErrorMessage(err, fallback) {
    if (err?.details && typeof err.details === "string") return err.details;
    if (err?.message && typeof err.message === "string") return err.message;
    return fallback;
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function cleanupMemberWatchers() {
    for (const unsubs of memberWatchers.values()) {
      for (const unsub of unsubs) unsub();
    }
    memberWatchers.clear();
  }

  function setGroupWatcher(groupId) {
    if (groupUnsub) {
      groupUnsub();
      groupUnsub = null;
    }
    cleanupMemberWatchers();
    groupUnsub = onSnapshot(doc(db, "groups", groupId), () => scheduleRender());
  }

  function syncMemberWatchers(groupId, members) {
    const wanted = new Set(members);

    for (const uid of wanted) {
      if (memberWatchers.has(uid)) continue;
      const checkinDocId = `${groupId}_${uid}_${todayStr()}`;
      const unsubUser = onSnapshot(doc(db, "users", uid), () => scheduleRender());
      const unsubCheckin = onSnapshot(doc(db, "checkins", checkinDocId), () => scheduleRender());
      memberWatchers.set(uid, [unsubUser, unsubCheckin]);
    }

    for (const [uid, unsubs] of memberWatchers.entries()) {
      if (wanted.has(uid)) continue;
      for (const unsub of unsubs) unsub();
      memberWatchers.delete(uid);
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
      let userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        await setDoc(userRef, {
          uid: currentUser.uid,
          name: currentUser.displayName || "",
          email: currentUser.email || "",
          nickname: currentUser.displayName || "사용자",
          currentChallengeStreak: 0,
          lastChallengeStreak: 0,
          currentGroupId: null,
          currentGroupInviteCode: null,
          createdAt: serverTimestamp()
        });
        userSnap = await getDoc(userRef);
      }

      const myData = userSnap.data();
      if (!myData.currentGroupId) {
        statusEl.textContent = "현재 참여 중인 그룹이 없습니다.";
        location.href = "/";
        return;
      }

      if (myData.currentGroupId !== currentGroupId) {
        currentGroupId = myData.currentGroupId;
        setGroupWatcher(currentGroupId);
      }

      const groupRef = doc(db, "groups", currentGroupId);
      const groupSnap = await getDoc(groupRef);
      if (!groupSnap.exists()) {
        statusEl.textContent = "그룹 정보를 찾을 수 없습니다.";
        await updateDoc(userRef, {
          currentGroupId: null,
          currentGroupInviteCode: null,
          lastChallengeStreak: myData.currentChallengeStreak || 0,
          currentChallengeStreak: 0
        });
        location.href = "/";
        return;
      }

      const groupData = groupSnap.data();
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
      const memberInfos = await Promise.all(
        members.map(async (uid) => {
          const [memberSnap, checkinSnap] = await Promise.all([
            getDoc(doc(db, "users", uid)),
            getDoc(doc(db, "checkins", `${currentGroupId}_${uid}_${today}`))
          ]);
          return { uid, memberSnap, checkinSnap };
        })
      );

      const memberElements = [];

      for (const { uid, memberSnap, checkinSnap } of memberInfos) {
        const m = memberSnap.exists() ? memberSnap.data() : null;
        const nickname = m?.nickname || m?.name || "사용자";
        const streak = m?.currentChallengeStreak || 0;
        const isMe = uid === currentUser.uid;

        let imageURL = null;
        let checkinStatus = null;
        if (checkinSnap.exists()) {
          const c = checkinSnap.data();
          imageURL = c.imageURL;
          checkinStatus = c.status || "approved";
        }

        let markClass = "wait";
        let markText = "⏳ 인증 대기";

        const now = new Date();
        const deadline = new Date();
        deadline.setHours(23, 59, 59, 999);

        if (checkinSnap.exists() && checkinStatus === "approved") {
          markClass = "ok";
          markText = "⭕ 인증 완료";
        } else if (checkinSnap.exists() && checkinStatus === "pending") {
          const approvals = Array.isArray(checkinSnap.data()?.approvals) ? checkinSnap.data().approvals.length : 0;
          const rejections = Array.isArray(checkinSnap.data()?.rejections) ? checkinSnap.data().rejections.length : 0;
          markClass = "wait";
          markText = `🟡 검토중 (${approvals}/${reviewRequired}, 반려 ${rejections}/${reviewRequired})`;
        } else if (checkinSnap.exists() && checkinStatus === "rejected") {
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

        if (imageURL) {
          li.style.cursor = "pointer";
          li.onclick = () => {
            photoViewer.src = imageURL;
            photoModal.style.display = "flex";
          };
        }

        if (checkinSnap.exists() && checkinStatus !== "approved") {
          const actions = document.createElement("div");
          actions.style.display = "flex";
          actions.style.gap = "6px";
          actions.style.marginTop = "8px";

          const approveBtn = document.createElement("button");
          approveBtn.className = "btn compact";
          approveBtn.textContent = "승인";
          approveBtn.onclick = async (e) => {
            e.stopPropagation();
            try {
              const approveFn = httpsCallable(functions, "approveCheckin");
              const res = await approveFn({ groupId: currentGroupId, targetUid: uid, date: today });
              if (res?.data?.approved) {
                alert("승인이 확정되었습니다.");
              }
            } catch (err) {
              console.error("approveCheckin failed", err);
              alert(extractFunctionErrorMessage(err, "승인 처리 중 오류가 발생했습니다."));
            }
          };

          const rejectBtn = document.createElement("button");
          rejectBtn.className = "btn compact ghost";
          rejectBtn.textContent = "반려";
          rejectBtn.onclick = async (e) => {
            e.stopPropagation();
            try {
              const rejectFn = httpsCallable(functions, "rejectCheckin");
              const res = await rejectFn({ groupId: currentGroupId, targetUid: uid, date: today });
              if (res?.data?.rejected) {
                alert("반려가 확정되었습니다.");
              }
            } catch (err) {
              console.error("rejectCheckin failed", err);
              alert(extractFunctionErrorMessage(err, "반려 처리 중 오류가 발생했습니다."));
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

      let statusText = "그룹 ID : " + currentGroupId;
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

        if (isManagedRoom && (groupStatus === "waiting" || groupStatus === "active")) {
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
        const myTodaySnap = await getDoc(todayCheckinRef);
        const hasMyTodayCheckin = myTodaySnap.exists();
        const myTodayData = hasMyTodayCheckin ? myTodaySnap.data() : null;
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
            const willChange = confirm("확인을 누르면 사진 변경, 취소를 누르면 삭제 선택으로 이동합니다.");

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
                const latestUserSnap = await getDoc(userRef);
                const currentStreak = latestUserSnap.exists() ? (latestUserSnap.data().currentChallengeStreak || 0) : 0;
                await updateDoc(userRef, { currentChallengeStreak: Math.max(currentStreak - 1, 0) });
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
              const latestUserSnap = await getDoc(userRef);
              const currentStreak = latestUserSnap.exists() ? (latestUserSnap.data().currentChallengeStreak || 0) : 0;
              await updateDoc(userRef, { currentChallengeStreak: Math.max(currentStreak - 1, 0) });
            }

            alert("오늘 인증이 취소되었습니다.");
          };
        } else if (!challengeLocked) {
          checkinBtn.textContent = "오늘 인증 제출";
          checkinBtn.onclick = async () => {
            if (!fileInput || !fileInput.files[0]) {
              alert("먼저 인증 사진을 선택해 주세요.");
              return;
            }

            const file = fileInput.files[0];
            const todayCheckinSnap = await getDoc(todayCheckinRef);
            if (todayCheckinSnap.exists()) {
              alert("오늘은 이미 인증이 완료되었습니다.");
              return;
            }

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
        currentGroupId: null,
        currentGroupInviteCode: null,
        createdAt: serverTimestamp()
      });
      userSnap = await getDoc(userRef);
    }

    const myData = userSnap.data();
    if (!myData.currentGroupId) {
      statusEl.textContent = "현재 참여 중인 그룹이 없습니다.";
      return;
    }

    currentGroupId = myData.currentGroupId;

    if (userUnsub) userUnsub();
    userUnsub = onSnapshot(userRef, (snap) => {
      if (!snap.exists()) return;
      const latest = snap.data();
      if (!latest.currentGroupId) {
        location.href = "/";
        return;
      }
      if (latest.currentGroupId !== currentGroupId) {
        currentGroupId = latest.currentGroupId;
        setGroupWatcher(currentGroupId);
      }
      scheduleRender();
    });

    setGroupWatcher(currentGroupId);
    scheduleRender();
  });
});
