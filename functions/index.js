import crypto from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

initializeApp();
const db = getFirestore();

function requireAuth(request) {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  return uid;
}

function hashPassword(password, saltHex) {
  return crypto.createHash("sha256").update(`${saltHex}:${password}`).digest("hex");
}

function generateRoomCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function validateRoomInput(data) {
  const title = (data?.title || "").trim();
  const topic = (data?.topic || "").trim();
  const visibility = data?.visibility === "private" ? "private" : "public";
  const password = (data?.password || "").trim();

  if (!title || title.length > 30) {
    throw new HttpsError("invalid-argument", "방 이름은 1~30자여야 합니다.");
  }
  if (!topic || topic.length > 40) {
    throw new HttpsError("invalid-argument", "주제는 1~40자여야 합니다.");
  }
  if (visibility === "private" && password.length < 4) {
    throw new HttpsError("invalid-argument", "비공개방 비밀번호는 4자 이상이어야 합니다.");
  }

  return { title, topic, visibility, password };
}

function mapError(err) {
  if (err instanceof HttpsError) return err;
  if (err?.code === 7 || String(err?.details || "").includes("Missing or insufficient permissions")) {
    return new HttpsError("permission-denied", "서버 서비스계정에 Firestore 권한이 없습니다. 관리자 권한 설정이 필요합니다.");
  }
  if (String(err?.message || "").includes("indexes")) {
    return new HttpsError("failed-precondition", "Firestore 인덱스가 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.");
  }
  switch (err?.message) {
    case "ALREADY_IN_GROUP":
      return new HttpsError("failed-precondition", "이미 참여 중인 방이 있습니다.");
    case "ROOM_NOT_FOUND":
      return new HttpsError("not-found", "방을 찾을 수 없습니다.");
    case "ROOM_NOT_WAITING":
      return new HttpsError("failed-precondition", "이미 시작되었거나 종료된 방입니다.");
    case "ROOM_FULL":
      return new HttpsError("failed-precondition", "방 정원이 가득 찼습니다.");
    case "PASSWORD_INVALID":
      return new HttpsError("permission-denied", "비밀번호가 올바르지 않습니다.");
    case "NOT_DISSOLVABLE":
      return new HttpsError("failed-precondition", "현재 상태에서는 해산할 수 없습니다.");
    case "NOT_OWNER":
      return new HttpsError("permission-denied", "방장만 처리할 수 있습니다.");
    case "CHECKIN_NOT_FOUND":
      return new HttpsError("not-found", "인증 내역을 찾을 수 없습니다.");
    case "INVALID_DATE":
      return new HttpsError("invalid-argument", "올바른 날짜 형식이 아닙니다.");
    case "NOT_ADMIN":
      return new HttpsError("permission-denied", "관리자만 실행할 수 있습니다.");
    case "NOT_MEMBER":
      return new HttpsError("permission-denied", "방 멤버만 처리할 수 있습니다.");
    default:
      console.error("Unhandled function error:", err);
      return new HttpsError("internal", "서버 내부 오류가 발생했습니다.");
  }
}

const fnOptions = {
  region: "asia-northeast3",
  serviceAccount: "a-compulsory-challenge@appspot.gserviceaccount.com",
  invoker: "public"
};

const ADMIN_EMAILS = new Set(["leegiju012@gmail.com"]);

function requireAdmin(request) {
  const uid = requireAuth(request);
  const email = String(request.auth?.token?.email || "").trim().toLowerCase();
  if (!ADMIN_EMAILS.has(email)) {
    throw new Error("NOT_ADMIN");
  }
  return uid;
}

export const createRoom = onCall(fnOptions, async (request) => {
  try {
    const uid = requireAuth(request);
    const { title, topic, visibility, password } = validateRoomInput(request.data);

    const userRef = db.collection("users").doc(uid);

    let roomCode = null;
    for (let i = 0; i < 10; i++) {
      const candidate = generateRoomCode(6);
      const dup = await db.collection("groups").where("roomCode", "==", candidate).limit(1).get();
      if (dup.empty) {
        roomCode = candidate;
        break;
      }
    }
    if (!roomCode) {
      throw new HttpsError("resource-exhausted", "방 코드 생성에 실패했습니다. 다시 시도해 주세요.");
    }

    const groupRef = db.collection("groups").doc();
    const secretRef = db.collection("groupSecrets").doc(groupRef.id);

    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      if (userSnap.exists && userSnap.data().currentGroupId) {
        throw new Error("ALREADY_IN_GROUP");
      }

      tx.set(groupRef, {
        title,
        topic,
        visibility,
        roomCode,
        members: [uid],
        ownerUid: uid,
        mode: "custom",
        status: "waiting",
        startedAt: null,
        closedAt: null,
        createdAt: FieldValue.serverTimestamp()
      });

      if (visibility === "private") {
        const salt = crypto.randomBytes(16).toString("hex");
        tx.set(secretRef, {
          passwordSalt: salt,
          passwordHash: hashPassword(password, salt),
          createdAt: FieldValue.serverTimestamp()
        });
      }

      tx.set(
        userRef,
        { currentGroupId: groupRef.id, currentGroupInviteCode: null, currentChallengeStreak: 0 },
        { merge: true }
      );
    });

    return { groupId: groupRef.id, title, roomCode };
  } catch (err) {
    console.error("createRoom failed", { uid: request.auth?.uid || null, err });
    throw mapError(err);
  }
});

export const joinRoom = onCall(fnOptions, async (request) => {
  try {
    const uid = requireAuth(request);
    const groupId = (request.data?.groupId || "").trim();
    const password = (request.data?.password || "").trim();

    if (!groupId) {
      throw new HttpsError("invalid-argument", "groupId가 필요합니다.");
    }

    const userRef = db.collection("users").doc(uid);
    const groupRef = db.collection("groups").doc(groupId);
    const secretRef = db.collection("groupSecrets").doc(groupId);

    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      if (userSnap.exists && userSnap.data().currentGroupId) {
        throw new Error("ALREADY_IN_GROUP");
      }

      const groupSnap = await tx.get(groupRef);
      if (!groupSnap.exists) {
        throw new Error("ROOM_NOT_FOUND");
      }

      const group = groupSnap.data();
      const members = Array.isArray(group.members) ? group.members : [];
      const status = group.status || "waiting";

      if (status !== "waiting") {
        throw new Error("ROOM_NOT_WAITING");
      }

      if (!members.includes(uid) && members.length >= 5) {
        throw new Error("ROOM_FULL");
      }

      if ((group.visibility || "public") === "private") {
        const secretSnap = await tx.get(secretRef);
        if (!secretSnap.exists) {
          throw new Error("PASSWORD_INVALID");
        }
        const secret = secretSnap.data();
        const expectedHash = hashPassword(password, secret.passwordSalt);
        if (expectedHash !== secret.passwordHash) {
          throw new Error("PASSWORD_INVALID");
        }
      }

      const nextMembers = members.includes(uid) ? members : [...members, uid];
      tx.update(groupRef, { members: nextMembers });
      tx.set(
        userRef,
        { currentGroupId: groupRef.id, currentGroupInviteCode: null, currentChallengeStreak: 0 },
        { merge: true }
      );
    });

    return { groupId };
  } catch (err) {
    console.error("joinRoom failed", {
      uid: request.auth?.uid || null,
      groupId: request.data?.groupId || null,
      err
    });
    throw mapError(err);
  }
});

export const leaveGroup = onCall(fnOptions, async (request) => {
  try {
    const uid = requireAuth(request);
    const requestedGroupId = (request.data?.groupId || "").trim();
    const userRef = db.collection("users").doc(uid);

    let dissolved = false;
    let groupId = requestedGroupId || null;

    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      const userData = userSnap.exists ? userSnap.data() : {};
      const currentGroupId = userData?.currentGroupId || null;

      if (!groupId) groupId = currentGroupId;
      if (!groupId) {
        tx.set(
          userRef,
          {
            currentGroupId: null,
            currentGroupInviteCode: null,
            lastChallengeStreak: userData?.currentChallengeStreak || 0,
            currentChallengeStreak: 0
          },
          { merge: true }
        );
        return;
      }

      const groupRef = db.collection("groups").doc(groupId);
      const groupSnap = await tx.get(groupRef);

      tx.set(
        userRef,
        {
          currentGroupId: null,
          currentGroupInviteCode: null,
          lastChallengeStreak: userData?.currentChallengeStreak || 0,
          currentChallengeStreak: 0
        },
        { merge: true }
      );

      if (!groupSnap.exists) return;

      const group = groupSnap.data();
      const members = Array.isArray(group.members) ? group.members : [];
      if (!members.includes(uid)) return;

      const nextMembers = members.filter((memberUid) => memberUid !== uid);
      const currentOwnerUid = group.ownerUid || null;

      if (nextMembers.length === 0) {
        tx.delete(groupRef);
        tx.delete(db.collection("groupSecrets").doc(groupId));
        dissolved = true;
        return;
      }

      const nextOwnerUid = currentOwnerUid === uid ? nextMembers[0] : currentOwnerUid;
      tx.update(groupRef, {
        members: nextMembers,
        ownerUid: nextOwnerUid
      });
    });

    return { groupId, dissolved };
  } catch (err) {
    console.error("leaveGroup failed", {
      uid: request.auth?.uid || null,
      groupId: request.data?.groupId || null,
      err
    });
    throw mapError(err);
  }
});

export const dissolveRoom = onCall(fnOptions, async (request) => {
  try {
    const voterUid = requireAuth(request);
    const groupId = (request.data?.groupId || "").trim();
    if (!groupId) {
      throw new HttpsError("invalid-argument", "groupId가 필요합니다.");
    }

    const groupRef = db.collection("groups").doc(groupId);
    let dissolved = false;
    let votes = 0;
    let required = 0;

    await db.runTransaction(async (tx) => {
      const groupSnap = await tx.get(groupRef);
      if (!groupSnap.exists) {
        throw new Error("ROOM_NOT_FOUND");
      }

      const group = groupSnap.data();
      const members = Array.isArray(group.members) ? group.members : [];
      const mode = group.mode || (group.inviteCode ? "private" : "random");
      const ownerUid = group.ownerUid || (members.length > 0 ? members[0] : null);
      const status = group.status || (mode === "random" ? "active" : "waiting");
      const canVote = mode !== "random" && (status === "active" || status === "waiting");
      if (!canVote) {
        throw new Error("NOT_DISSOLVABLE");
      }
      if (!members.includes(voterUid)) {
        throw new Error("NOT_MEMBER");
      }

      const memberSnapshots = [];
      for (const memberUid of members) {
        const memberRef = db.collection("users").doc(memberUid);
        const memberSnap = await tx.get(memberRef);
        memberSnapshots.push({
          memberUid,
          memberRef,
          memberData: memberSnap.exists ? memberSnap.data() : {}
        });
      }

      const currentVotes = Array.isArray(group.dissolveVotes) ? group.dissolveVotes : [];
      const nextVotes = currentVotes.includes(voterUid) ? currentVotes : [...currentVotes, voterUid];
      const instantDissolveInPair = members.length === 2;
      required = instantDissolveInPair ? 1 : (Math.floor(members.length / 2) + 1);
      votes = nextVotes.length;

      if (votes >= required) {
        for (const { memberRef, memberData } of memberSnapshots) {
          tx.set(
            memberRef,
            {
              currentGroupId: null,
              currentGroupInviteCode: null,
              lastChallengeStreak: memberData?.currentChallengeStreak || 0,
              currentChallengeStreak: 0
            },
            { merge: true }
          );
        }

        tx.update(groupRef, {
          status: "closed",
          closedAt: FieldValue.serverTimestamp(),
          dissolveVotes: []
        });
        dissolved = true;
      } else {
        tx.set(
          groupRef,
          {
            dissolveVotes: nextVotes,
            dissolveVoteRequired: required,
            dissolveVoteUpdatedAt: FieldValue.serverTimestamp(),
            dissolveVoteRequestedBy: ownerUid || voterUid
          },
          { merge: true }
        );
      }
    });

    return { groupId, dissolved, votes, required };
  } catch (err) {
    console.error("dissolveRoom failed", {
      uid: request.auth?.uid || null,
      groupId: request.data?.groupId || null,
      err
    });
    throw mapError(err);
  }
});

function isValidDateString(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr || "");
}

function yesterdayStr(dateStr) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export const approveCheckin = onCall(fnOptions, async (request) => {
  try {
    const voterUid = requireAuth(request);
    const groupId = (request.data?.groupId || "").trim();
    const targetUid = (request.data?.targetUid || "").trim();
    const date = (request.data?.date || "").trim();

    if (!groupId || !targetUid || !isValidDateString(date)) {
      throw new Error("INVALID_DATE");
    }

    const groupRef = db.collection("groups").doc(groupId);
    const userRef = db.collection("users").doc(targetUid);
    const checkinRef = db.collection("checkins").doc(`${groupId}_${targetUid}_${date}`);
    const yesterdayRef = db.collection("checkins").doc(`${groupId}_${targetUid}_${yesterdayStr(date)}`);
    let approved = false;
    let votes = 0;
    let required = 0;

    await db.runTransaction(async (tx) => {
      const [groupSnap, userSnap, checkinSnap, yesterdaySnap] = await Promise.all([
        tx.get(groupRef),
        tx.get(userRef),
        tx.get(checkinRef),
        tx.get(yesterdayRef)
      ]);

      if (!groupSnap.exists) throw new Error("ROOM_NOT_FOUND");
      if (!checkinSnap.exists) throw new Error("CHECKIN_NOT_FOUND");

      const group = groupSnap.data();
      const members = Array.isArray(group.members) ? group.members : [];
      const ownerUid = group.ownerUid || (members.length > 0 ? members[0] : null);
      const ownerSoloInPair = members.length === 2 && voterUid === ownerUid;
      if (!members.includes(targetUid)) throw new Error("ROOM_NOT_FOUND");
      if (!members.includes(voterUid)) throw new Error("NOT_MEMBER");

      const checkin = checkinSnap.data();
      const alreadyCounted = !!checkin.streakCounted;
      if ((checkin.status || "pending") === "approved") {
        approved = true;
        votes = Array.isArray(checkin.approvals) ? checkin.approvals.length : 0;
        required = ownerSoloInPair ? 1 : Math.min(2, members.length);
        return;
      }

      const approvals = Array.isArray(checkin.approvals) ? checkin.approvals : [];
      const rejections = Array.isArray(checkin.rejections) ? checkin.rejections : [];
      const nextApprovals = approvals.includes(voterUid) ? approvals : [...approvals, voterUid];
      const nextRejections = rejections.filter((uid) => uid !== voterUid);
      required = ownerSoloInPair ? 1 : Math.min(2, members.length);
      votes = nextApprovals.length;
      approved = votes >= required;

      tx.set(
        checkinRef,
        {
          status: approved ? "approved" : "pending",
          approvals: nextApprovals,
          rejections: nextRejections,
          reviewedBy: approved ? voterUid : null,
          reviewedAt: approved ? FieldValue.serverTimestamp() : null
        },
        { merge: true }
      );

      if (approved && !alreadyCounted) {
        const userData = userSnap.exists ? userSnap.data() : {};
        const currentStreak = userData?.currentChallengeStreak || 0;
        const prevApproved = yesterdaySnap.exists && (yesterdaySnap.data()?.status || "") === "approved";
        const nextStreak = prevApproved ? currentStreak + 1 : 1;

        tx.set(
          userRef,
          { currentChallengeStreak: nextStreak },
          { merge: true }
        );

        tx.set(
          checkinRef,
          { streakCounted: true },
          { merge: true }
        );
      }
    });

    return { ok: true, approved, votes, required };
  } catch (err) {
    console.error("approveCheckin failed", {
      uid: request.auth?.uid || null,
      groupId: request.data?.groupId || null,
      targetUid: request.data?.targetUid || null,
      date: request.data?.date || null,
      err
    });
    throw mapError(err);
  }
});

export const rejectCheckin = onCall(fnOptions, async (request) => {
  try {
    const voterUid = requireAuth(request);
    const groupId = (request.data?.groupId || "").trim();
    const targetUid = (request.data?.targetUid || "").trim();
    const date = (request.data?.date || "").trim();

    if (!groupId || !targetUid || !isValidDateString(date)) {
      throw new Error("INVALID_DATE");
    }

    const groupRef = db.collection("groups").doc(groupId);
    const userRef = db.collection("users").doc(targetUid);
    const checkinRef = db.collection("checkins").doc(`${groupId}_${targetUid}_${date}`);
    let rejected = false;
    let votes = 0;
    let required = 0;

    await db.runTransaction(async (tx) => {
      const [groupSnap, userSnap, checkinSnap] = await Promise.all([
        tx.get(groupRef),
        tx.get(userRef),
        tx.get(checkinRef)
      ]);

      if (!groupSnap.exists) throw new Error("ROOM_NOT_FOUND");
      if (!checkinSnap.exists) throw new Error("CHECKIN_NOT_FOUND");

      const group = groupSnap.data();
      const members = Array.isArray(group.members) ? group.members : [];
      const ownerUid = group.ownerUid || (members.length > 0 ? members[0] : null);
      const ownerSoloInPair = members.length === 2 && voterUid === ownerUid;
      if (!members.includes(targetUid)) throw new Error("ROOM_NOT_FOUND");
      if (!members.includes(voterUid)) throw new Error("NOT_MEMBER");

      const checkin = checkinSnap.data();
      const wasCounted = !!checkin.streakCounted;
      if ((checkin.status || "pending") === "rejected") {
        rejected = true;
        votes = Array.isArray(checkin.rejections) ? checkin.rejections.length : 0;
        required = ownerSoloInPair ? 1 : Math.min(2, members.length);
      } else {
        const approvals = Array.isArray(checkin.approvals) ? checkin.approvals : [];
        const rejections = Array.isArray(checkin.rejections) ? checkin.rejections : [];
        const nextRejections = rejections.includes(voterUid) ? rejections : [...rejections, voterUid];
        const nextApprovals = approvals.filter((uid) => uid !== voterUid);
        required = ownerSoloInPair ? 1 : Math.min(2, members.length);
        votes = nextRejections.length;
        rejected = votes >= required;

        tx.set(
          checkinRef,
          {
            status: rejected ? "rejected" : "pending",
            approvals: nextApprovals,
            rejections: nextRejections,
            reviewedBy: rejected ? voterUid : null,
            reviewedAt: rejected ? FieldValue.serverTimestamp() : null,
            streakCounted: rejected ? false : wasCounted
          },
          { merge: true }
        );
      }

      if (rejected && wasCounted) {
        const userData = userSnap.exists ? userSnap.data() : {};
        const currentStreak = userData?.currentChallengeStreak || 0;
        tx.set(
          userRef,
          { currentChallengeStreak: Math.max(currentStreak - 1, 0) },
          { merge: true }
        );
      }
    });

    return { ok: true, rejected, votes, required };
  } catch (err) {
    console.error("rejectCheckin failed", {
      uid: request.auth?.uid || null,
      groupId: request.data?.groupId || null,
      targetUid: request.data?.targetUid || null,
      date: request.data?.date || null,
      err
    });
    throw mapError(err);
  }
});

async function chunkDeleteByQuery(querySnap, extraOps = () => {}) {
  const batch = db.batch();
  let count = 0;
  for (const docSnap of querySnap.docs) {
    batch.delete(docSnap.ref);
    count += 1;
    extraOps(batch, docSnap);
  }
  if (count > 0) {
    await batch.commit();
  }
  return count;
}

export const runMaintenanceCleanup = onCall(fnOptions, async (request) => {
  try {
    requireAdmin(request);

    const now = new Date();
    const nowDate = now.toISOString().slice(0, 10);
    const cutoffCheckins = new Date(now);
    cutoffCheckins.setDate(cutoffCheckins.getDate() - 30);
    const cutoffCheckinsStr = cutoffCheckins.toISOString().slice(0, 10);

    const cutoffClosed = new Date(now);
    cutoffClosed.setDate(cutoffClosed.getDate() - 7);
    const cutoffClosedTs = Timestamp.fromDate(cutoffClosed);

    const summary = {
      runAt: nowDate,
      deletedCheckins: 0,
      deletedClosedGroups: 0,
      deletedGroupSecrets: 0,
      resetDanglingUsers: 0
    };

    const oldCheckinsSnap = await db
      .collection("checkins")
      .where("date", "<=", cutoffCheckinsStr)
      .limit(400)
      .get();
    summary.deletedCheckins += await chunkDeleteByQuery(oldCheckinsSnap);

    const closedGroupsCandidateSnap = await db
      .collection("groups")
      .where("status", "==", "closed")
      .limit(300)
      .get();
    const closedGroups = closedGroupsCandidateSnap.docs.filter((groupDoc) => {
      const closedAt = groupDoc.data()?.closedAt;
      if (!closedAt || typeof closedAt.toMillis !== "function") return false;
      return closedAt.toMillis() <= cutoffClosedTs.toMillis();
    });

    for (const groupDoc of closedGroups) {
      const gid = groupDoc.id;
      const members = Array.isArray(groupDoc.data()?.members) ? groupDoc.data().members : [];
      const batch = db.batch();
      batch.delete(groupDoc.ref);
      summary.deletedClosedGroups += 1;

      batch.delete(db.collection("groupSecrets").doc(gid));
      summary.deletedGroupSecrets += 1;

      for (const memberUid of members) {
        const userRef = db.collection("users").doc(memberUid);
        batch.set(
          userRef,
          { currentGroupId: null, currentGroupInviteCode: null },
          { merge: true }
        );
        summary.resetDanglingUsers += 1;
      }

      await batch.commit();
    }

    return summary;
  } catch (err) {
    console.error("runMaintenanceCleanup failed", {
      uid: request.auth?.uid || null,
      email: request.auth?.token?.email || null,
      err
    });
    throw mapError(err);
  }
});
