import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, query, where, getCountFromServer, getDocs, limit, orderBy, Timestamp, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
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

  const ADMIN_EMAILS = ["leegiju012@gmail.com"];

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app, "asia-northeast3");

  const backProfileBtn = document.getElementById("backProfileBtn");
  const backLobbyBtn = document.getElementById("backLobbyBtn");
  const statUsers = document.getElementById("statUsers");
  const statWaiting = document.getElementById("statWaiting");
  const statActive = document.getElementById("statActive");
  const statCheckins = document.getElementById("statCheckins");
  const statErrorsToday = document.getElementById("statErrorsToday");
  const statErrorRateToday = document.getElementById("statErrorRateToday");
  const roomList = document.getElementById("roomList");
  const errorList = document.getElementById("errorList");
  const errorUserList = document.getElementById("errorUserList");
  const reportList = document.getElementById("reportList");
  const moderatedUserList = document.getElementById("moderatedUserList");
  const runCleanupBtn = document.getElementById("runCleanupBtn");
  const runBackfillBtn = document.getElementById("runBackfillBtn");
  const cleanupResult = document.getElementById("cleanupResult");
  const backfillResult = document.getElementById("backfillResult");
  let restrictionHandled = false;

  backProfileBtn.onclick = () => { location.href = "/profile.html"; };
  backLobbyBtn.onclick = () => { location.href = "/index.html"; };

  function todayStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
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

  async function renderReports() {
    if (!reportList) return;
    const reportSnap = await getDocs(query(collection(db, "reports"), orderBy("createdAt", "desc"), limit(30)));
    reportList.innerHTML = "";
    const openReports = reportSnap.docs.filter((d) => String(d.data()?.status || "open") === "open");

    if (!openReports.length) {
      const li = document.createElement("li");
      li.className = "item";
      li.innerHTML = '<div class="item-left"><div class="item-name">처리대기 신고 없음</div><div class="item-sub">모든 신고가 처리되었습니다.</div></div>';
      reportList.appendChild(li);
      return;
    }

    for (const d of openReports) {
      const r = d.data();
      const created = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString("ko-KR") : "-";
      const status = String(r.status || "open");
      const li = document.createElement("li");
      li.className = "item";

      const left = document.createElement("div");
      left.className = "item-left";
      left.innerHTML =
        `<div class="item-name">${status === "open" ? "처리대기" : status}</div>` +
        `<div class="item-sub">방 ${r.groupId || "-"} · 신고자 ${r.reporterUid || "-"} · 대상 ${r.targetUid || "-"}</div>` +
        `<div class="item-sub">${r.reason || "-"}</div>` +
        `<div class="item-sub">${created}</div>`;
      if (r.reportCheckinDate || r.reportCheckinStatus) {
        const extra = document.createElement("div");
        extra.className = "item-sub";
        extra.textContent = `인증일 ${r.reportCheckinDate || "-"} · 상태 ${r.reportCheckinStatus || "-"}`;
        left.appendChild(extra);
      }
      if (r.reportCheckinImageURL) {
        const link = document.createElement("a");
        link.href = r.reportCheckinImageURL;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "신고 사진 원본 보기";
        link.className = "item-sub";
        link.style.display = "inline-block";
        link.style.marginTop = "4px";
        left.appendChild(link);

        const img = document.createElement("img");
        img.src = r.reportCheckinImageURL;
        img.alt = "신고된 인증 사진";
        img.loading = "lazy";
        img.style.width = "84px";
        img.style.height = "84px";
        img.style.objectFit = "cover";
        img.style.borderRadius = "8px";
        img.style.marginTop = "8px";
        img.style.border = "1px solid #d1d5db";
        left.appendChild(img);
      }

      const actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "6px";
      actions.style.flexWrap = "wrap";

      const doneBtn = document.createElement("button");
      doneBtn.className = "btn ghost compact";
      doneBtn.textContent = "처리 완료";

      const dismissBtn = document.createElement("button");
      dismissBtn.className = "btn ghost compact";
      dismissBtn.textContent = "기각";

      const suspendBtn = document.createElement("button");
      suspendBtn.className = "btn ghost compact";
      suspendBtn.textContent = "7일 정지";

      const banBtn = document.createElement("button");
      banBtn.className = "btn ghost compact";
      banBtn.textContent = "영구 차단";

      const setAllDisabled = (disabled) => {
        doneBtn.disabled = disabled;
        dismissBtn.disabled = disabled;
        suspendBtn.disabled = disabled;
        banBtn.disabled = disabled;
      };

      doneBtn.onclick = async () => {
        setAllDisabled(true);
        try {
          const fn = httpsCallable(functions, "reviewReport");
          await fn({ reportId: d.id, decision: "resolved" });
          await renderReports();
        } catch (err) {
          console.error("reviewReport resolved failed", err);
          alert(typeof err?.details === "string" ? err.details : "신고 처리 중 오류가 발생했습니다.");
        } finally {
          setAllDisabled(false);
        }
      };

      dismissBtn.onclick = async () => {
        setAllDisabled(true);
        try {
          const fn = httpsCallable(functions, "reviewReport");
          await fn({ reportId: d.id, decision: "dismissed" });
          await renderReports();
        } catch (err) {
          console.error("reviewReport dismissed failed", err);
          alert(typeof err?.details === "string" ? err.details : "신고 기각 중 오류가 발생했습니다.");
        } finally {
          setAllDisabled(false);
        }
      };

      suspendBtn.onclick = async () => {
        if (!confirm("대상 사용자를 7일 정지할까요?")) return;
        setAllDisabled(true);
        try {
          const reason = (prompt("정지 사유(선택)") || "").trim();
          const moderate = httpsCallable(functions, "moderateUser");
          await moderate({ targetUid: r.targetUid, action: "suspend7d", reason });
          alert("7일 정지가 적용되었습니다.");
          await renderModeratedUsers();
        } catch (err) {
          console.error("moderateUser suspend failed", err);
          alert(typeof err?.details === "string" ? err.details : "정지 처리 중 오류가 발생했습니다.");
        } finally {
          setAllDisabled(false);
        }
      };

      banBtn.onclick = async () => {
        if (!confirm("대상 사용자를 영구 차단할까요?")) return;
        setAllDisabled(true);
        try {
          const reason = (prompt("차단 사유(선택)") || "").trim();
          const moderate = httpsCallable(functions, "moderateUser");
          await moderate({ targetUid: r.targetUid, action: "ban", reason });
          alert("영구 차단이 적용되었습니다.");
          await renderModeratedUsers();
        } catch (err) {
          console.error("moderateUser ban failed", err);
          alert(typeof err?.details === "string" ? err.details : "차단 처리 중 오류가 발생했습니다.");
        } finally {
          setAllDisabled(false);
        }
      };

      actions.appendChild(doneBtn);
      actions.appendChild(dismissBtn);
      actions.appendChild(suspendBtn);
      actions.appendChild(banBtn);
      li.appendChild(left);
      li.appendChild(actions);
      reportList.appendChild(li);
    }
  }

  function formatTs(value) {
    if (!value) return "-";
    if (typeof value?.toDate === "function") return value.toDate().toLocaleString("ko-KR");
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toLocaleString("ko-KR") : "-";
  }

  async function renderModeratedUsers() {
    if (!moderatedUserList) return;
    moderatedUserList.innerHTML = "";
    const suspendedSnap = await getDocs(
      query(collection(db, "users"), where("moderationStatus", "in", ["suspended", "banned"]), limit(50))
    );

    if (suspendedSnap.empty) {
      const li = document.createElement("li");
      li.className = "item";
      li.innerHTML = '<div class="item-left"><div class="item-name">제재 사용자 없음</div></div>';
      moderatedUserList.appendChild(li);
      return;
    }

    suspendedSnap.docs.forEach((d) => {
      const u = d.data();
      const li = document.createElement("li");
      li.className = "item";
      const status = String(u.moderationStatus || (u.banned ? "banned" : "active"));
      const until = formatTs(u.suspendedUntil);
      const name = String(u.nickname || u.name || d.id);

      const left = document.createElement("div");
      left.className = "item-left";
      left.innerHTML =
        `<div class="item-name">${name}</div>` +
        `<div class="item-sub">UID ${d.id}</div>` +
        `<div class="item-sub">상태 ${status}${status === "suspended" ? ` · 해제 예정 ${until}` : ""}</div>`;

      const liftBtn = document.createElement("button");
      liftBtn.className = "btn ghost compact";
      liftBtn.textContent = "정지 해제";
      liftBtn.onclick = async () => {
        if (!confirm("이 사용자의 제재를 해제할까요?")) return;
        liftBtn.disabled = true;
        try {
          const lift = httpsCallable(functions, "liftModeration");
          await lift({ targetUid: d.id });
          await renderModeratedUsers();
        } catch (err) {
          console.error("liftModeration failed", err);
          alert(typeof err?.details === "string" ? err.details : "정지 해제 중 오류가 발생했습니다.");
        } finally {
          liftBtn.disabled = false;
        }
      };

      li.appendChild(left);
      li.appendChild(liftBtn);
      moderatedUserList.appendChild(li);
    });
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      restrictionHandled = false;
      location.href = "/";
      return;
    }

    try {
      const userSnap = await getDoc(doc(db, "users", user.uid));
      const me = userSnap.exists() ? userSnap.data() : null;
      if (me && isRestrictedUser(me)) {
        if (!restrictionHandled) {
          restrictionHandled = true;
          alert(restrictedMessage(me));
        }
        await signOut(auth);
        return;
      }
    } catch (_) {
      // no-op
    }

    if (!ADMIN_EMAILS.includes(user.email || "")) {
      alert("운영 대시보드 접근 권한이 없습니다.");
      location.href = "/profile.html";
      return;
    }

    try {
      const usersQ = query(collection(db, "users"));
      const waitingQ = query(collection(db, "groups"), where("status", "==", "waiting"));
      const activeQ = query(collection(db, "groups"), where("status", "==", "active"));
      const checkinsQ = query(collection(db, "checkins"), where("date", "==", todayStr()));
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const errorsTodayQ = query(
        collection(db, "clientErrors"),
        where("createdAt", ">=", Timestamp.fromDate(dayStart))
      );

      const [usersCnt, waitingCnt, activeCnt, checkinsCnt, errorsTodayCnt] = await Promise.all([
        getCountFromServer(usersQ),
        getCountFromServer(waitingQ),
        getCountFromServer(activeQ),
        getCountFromServer(checkinsQ),
        getCountFromServer(errorsTodayQ)
      ]);

      statUsers.textContent = String(usersCnt.data().count);
      statWaiting.textContent = String(waitingCnt.data().count);
      statActive.textContent = String(activeCnt.data().count);
      statCheckins.textContent = String(checkinsCnt.data().count);
      statErrorsToday.textContent = String(errorsTodayCnt.data().count);
      const denominator = Math.max(1, Number(checkinsCnt.data().count) + Number(errorsTodayCnt.data().count));
      const rate = ((Number(errorsTodayCnt.data().count) / denominator) * 100).toFixed(1);
      statErrorRateToday.textContent = `${rate}%`;

      const waitingRoomsSnap = await getDocs(query(waitingQ, limit(20)));
      roomList.innerHTML = "";
      if (waitingRoomsSnap.empty) {
        const li = document.createElement("li");
        li.className = "item";
        li.innerHTML = '<div class="item-left"><div class="item-name">대기 방 없음</div><div class="item-sub">현재 대기 상태 방이 없습니다.</div></div>';
        roomList.appendChild(li);
      } else {
        waitingRoomsSnap.docs.forEach((d) => {
          const room = d.data();
          const li = document.createElement("li");
          li.className = "item";
          const members = Array.isArray(room.members) ? room.members.length : 0;
          li.innerHTML =
            `<div class="item-left">` +
            `<div class="item-name">${room.title || "제목 없는 방"}</div>` +
            `<div class="item-sub">${room.topic || "주제 미설정"}</div>` +
            `<div class="item-sub">코드 ${room.roomCode || "-"} · ${members}/5 · ${room.visibility === "private" ? "비공개" : "공개"}</div>` +
            `</div>`;
          roomList.appendChild(li);
        });
      }

      const errorSnap = await getDocs(query(collection(db, "clientErrors"), orderBy("createdAt", "desc"), limit(30)));
      errorList.innerHTML = "";
      if (errorSnap.empty) {
        const li = document.createElement("li");
        li.className = "item";
        li.innerHTML = '<div class="item-left"><div class="item-name">오류 없음</div><div class="item-sub">최근 클라이언트 오류 로그가 없습니다.</div></div>';
        errorList.appendChild(li);
      } else {
        errorSnap.docs.forEach((d) => {
          const e = d.data();
          const ts = e.createdAt?.toDate ? e.createdAt.toDate() : null;
          const when = ts ? ts.toLocaleString("ko-KR") : "-";
          const li = document.createElement("li");
          li.className = "item";
          li.innerHTML =
            `<div class="item-left">` +
            `<div class="item-name">${e.type || "unknown_error"}</div>` +
            `<div class="item-sub">${e.page || "-"} · ${e.code || "no-code"} · ${when}</div>` +
            `<div class="item-sub">${e.message || "-"}</div>` +
            `</div>`;
          errorList.appendChild(li);
        });
      }

      const errorByUser = new Map();
      errorSnap.docs.forEach((d) => {
        const e = d.data();
        const uid = String(e.uid || "unknown");
        errorByUser.set(uid, (errorByUser.get(uid) || 0) + 1);
      });
      const topUsers = [...errorByUser.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      errorUserList.innerHTML = "";
      if (!topUsers.length) {
        const li = document.createElement("li");
        li.className = "item";
        li.innerHTML = '<div class="item-left"><div class="item-name">대상 없음</div><div class="item-sub">오늘 오류 사용자 집계가 없습니다.</div></div>';
        errorUserList.appendChild(li);
      } else {
        topUsers.forEach(([uid, cnt]) => {
          const li = document.createElement("li");
          li.className = "item";
          li.innerHTML =
            `<div class="item-left">` +
            `<div class="item-name">${uid}</div>` +
            `<div class="item-sub">오류 ${cnt}건</div>` +
            `</div>`;
          errorUserList.appendChild(li);
        });
      }

      runCleanupBtn.onclick = async () => {
        runCleanupBtn.disabled = true;
        try {
          const runCleanup = httpsCallable(functions, "runMaintenanceCleanup");
          const res = await runCleanup({});
          const d = res?.data || {};
          cleanupResult.textContent =
            `정리 완료 · checkins ${d.deletedCheckins || 0}, 닫힌방 ${d.deletedClosedGroups || 0}, ` +
            `비밀문서 ${d.deletedGroupSecrets || 0}, 유저정리 ${d.resetDanglingUsers || 0}`;
        } catch (err) {
          console.error("runMaintenanceCleanup failed", err);
          cleanupResult.textContent = "정리 실행 실패";
          alert(typeof err?.details === "string" ? err.details : "정리 실행 중 오류가 발생했습니다.");
        } finally {
          runCleanupBtn.disabled = false;
        }
      };

      runBackfillBtn.onclick = async () => {
        if (!confirm("기존 인증 데이터로 방별 연속일 백필을 실행할까요?")) return;
        runBackfillBtn.disabled = true;
        if (backfillResult) backfillResult.textContent = "백필 실행 중...";
        try {
          const runBackfill = httpsCallable(functions, "backfillGroupMemberStats");
          const res = await runBackfill({ dryRun: false });
          const d = res?.data || {};
          if (backfillResult) {
            backfillResult.textContent =
              `백필 완료 · 대상 ${d.memberStatsTargets || 0}, 쓰기 ${d.writes || 0}, 스캔 ${d.scanned || 0}`;
          }
        } catch (err) {
          console.error("backfillGroupMemberStats failed", err);
          if (backfillResult) backfillResult.textContent = "백필 실행 실패";
          alert(typeof err?.details === "string" ? err.details : "백필 실행 중 오류가 발생했습니다.");
        } finally {
          runBackfillBtn.disabled = false;
        }
      };

      await renderReports();
      await renderModeratedUsers();
    } catch (err) {
      console.error("admin dashboard load failed", err);
      alert("대시보드 로딩 중 오류가 발생했습니다.");
    }
  });
});
