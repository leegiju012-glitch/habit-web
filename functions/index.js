import crypto from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

initializeApp();
const db = getFirestore();
const messaging = getMessaging();
const PRODUCT_AD_FREE_LIFETIME = "ad_free_lifetime_5500";
const PRODUCT_PRO_MONTHLY = "pro_monthly_3900";

function normalizePlan(plan) {
  return plan === "pro" ? "pro" : "free";
}

function maxGroupsByPlan(plan) {
  return normalizePlan(plan) === "pro" ? 5 : 1;
}

function normalizeJoinedGroupIds(userData = {}) {
  const raw = Array.isArray(userData.joinedGroupIds) ? userData.joinedGroupIds : [];
  const out = [];
  for (const gid of raw) {
    if (typeof gid !== "string" || !gid.trim()) continue;
    if (!out.includes(gid)) out.push(gid);
  }
  const current = typeof userData.currentGroupId === "string" ? userData.currentGroupId : "";
  if (current && !out.includes(current)) out.push(current);
  return out;
}
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
  const checkinRule = (data?.checkinRule || "").trim();
  const visibility = data?.visibility === "private" ? "private" : "public";
  const password = (data?.password || "").trim();

  if (!title || title.length > 30) {
    throw new HttpsError("invalid-argument", "방 이름은 1~30자여야 합니다.");
  }
  if (!topic || topic.length > 40) {
    throw new HttpsError("invalid-argument", "주제는 1~40자여야 합니다.");
  }
  if (!checkinRule || checkinRule.length > 120) {
    throw new HttpsError("invalid-argument", "인증 사진 규칙은 1~120자여야 합니다.");
  }
  if (visibility === "private" && password.length < 4) {
    throw new HttpsError("invalid-argument", "비공개방 비밀번호는 4자 이상이어야 합니다.");
  }

  return { title, topic, checkinRule, visibility, password };
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
    case "PLAN_LIMIT":
      return new HttpsError("failed-precondition", "요금제의 참여 가능 방 수를 초과했습니다.");
    case "PASSWORD_INVALID":
      return new HttpsError("permission-denied", "비밀번호가 올바르지 않습니다.");
    case "RULE_NOT_ACCEPTED":
      return new HttpsError("failed-precondition", "방 입장 전에 인증 규칙 수락이 필요합니다.");
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

async function loadTokensByUids(uids = []) {
  const uniq = [...new Set((uids || []).filter((v) => typeof v === "string" && v))];
  if (!uniq.length) return [];
  const snaps = await Promise.all(uniq.map((uid) => db.collection("users").doc(uid).get()));
  return snaps
    .map((s) => (s.exists ? String(s.data()?.fcmToken || "").trim() : ""))
    .filter(Boolean);
}

async function sendPushToUids(uids = [], notification = {}, data = {}) {
  const tokens = await loadTokensByUids(uids);
  if (!tokens.length) return { sent: 0 };
  const res = await messaging.sendEachForMulticast({
    tokens,
    notification,
    data: Object.fromEntries(
      Object.entries(data || {}).map(([k, v]) => [String(k), String(v ?? "")])
    )
  });
  return { sent: res.successCount, failed: res.failureCount };
}

const ADMIN_EMAILS = new Set(["leegiju012@gmail.com"]);

function requireAdmin(request) {
  const uid = requireAuth(request);
  const email = String(request.auth?.token?.email || "").trim().toLowerCase();
  if (!ADMIN_EMAILS.has(email)) {
    throw new Error("NOT_ADMIN");
  }
  return uid;
}

function validatePurchaseInput(data) {
  const productId = String(data?.productId || "").trim();
  const receipt = String(data?.receipt || "").trim();
  const transactionId = String(data?.transactionId || "").trim();
  if (productId !== PRODUCT_AD_FREE_LIFETIME) {
    throw new HttpsError("invalid-argument", "지원하지 않는 상품입니다.");
  }
  if (!receipt && !transactionId) {
    throw new HttpsError("invalid-argument", "영수증 또는 거래 ID가 필요합니다.");
  }
  return { productId, receipt, transactionId };
}

async function grantEntitlement({ uid, provider, productId, transactionId, receiptHash, rawReceipt }) {
  const userRef = db.collection("users").doc(uid);
  const eventId = `${provider}_${transactionId || receiptHash}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 180);
  const eventRef = db.collection("purchaseEvents").doc(eventId);

  let granted = false;
  await db.runTransaction(async (tx) => {
    const eventSnap = await tx.get(eventRef);
    if (eventSnap.exists) {
      return;
    }
    tx.set(eventRef, {
      uid,
      provider,
      productId,
      transactionId: transactionId || null,
      receiptHash: receiptHash || null,
      rawReceipt: rawReceipt || null,
      status: "granted",
      grantedAt: FieldValue.serverTimestamp()
    });
    tx.set(userRef, {
      isAdFree: true,
      adFreeProductId: productId,
      adFreeProvider: provider,
      adFreePurchasedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    granted = true;
  });

  return { granted, eventId };
}

export const createRoom = onCall(fnOptions, async (request) => {
  try {
    const uid = requireAuth(request);
    const { title, topic, checkinRule, visibility, password } = validateRoomInput(request.data);

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
      const userData = userSnap.exists ? userSnap.data() : {};
      const plan = normalizePlan(userData?.plan);
      const joined = normalizeJoinedGroupIds(userData);
      const maxGroups = maxGroupsByPlan(plan);
      if (joined.length >= maxGroups) throw new Error("PLAN_LIMIT");

      tx.set(groupRef, {
        title,
        topic,
        checkinRule,
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
        {
          currentGroupId: groupRef.id,
          currentGroupInviteCode: null,
          joinedGroupIds: [...joined, groupRef.id],
          plan
        },
        { merge: true }
      );
    });

    return { groupId: groupRef.id, title, roomCode };
  } catch (err) {
    console.error("createRoom failed", { uid: request.auth?.uid || null, err });
    throw mapError(err);
  }
});

export const verifyTossPurchase = onCall(fnOptions, async (request) => {
  try {
    const uid = requireAuth(request);
    const { productId, receipt, transactionId } = validatePurchaseInput(request.data);

    // TODO: Connect Toss payment verification API and replace this placeholder validation.
    // For now we only accept a test transaction id prefix to exercise end-to-end flow safely.
    if (!transactionId.startsWith("TOSS_TEST_")) {
      throw new HttpsError("failed-precondition", "토스 검증 연동 전입니다. 테스트 거래 ID(TOSS_TEST_*)를 사용해 주세요.");
    }

    const receiptHash = crypto.createHash("sha256").update(`${uid}:${receipt || transactionId}`).digest("hex");
    const result = await grantEntitlement({
      uid,
      provider: "toss",
      productId,
      transactionId,
      receiptHash,
      rawReceipt: receipt || null
    });
    return { ok: true, ...result, productId };
  } catch (err) {
    console.error("verifyTossPurchase failed", { uid: request.auth?.uid || null, err });
    throw mapError(err);
  }
});

export const verifyApplePurchase = onCall(fnOptions, async (request) => {
  try {
    const uid = requireAuth(request);
    const { productId, receipt, transactionId } = validatePurchaseInput(request.data);

    // TODO: Replace with Apple receipt server verification.
    if (!String(receipt || "").startsWith("APPLE_TEST_") && !String(transactionId || "").startsWith("APPLE_TEST_")) {
      throw new HttpsError("failed-precondition", "애플 검증 연동 전입니다. 테스트 영수증(APPLE_TEST_*)을 사용해 주세요.");
    }

    const receiptHash = crypto.createHash("sha256").update(`${uid}:${receipt || transactionId}`).digest("hex");
    const result = await grantEntitlement({
      uid,
      provider: "apple",
      productId,
      transactionId,
      receiptHash,
      rawReceipt: receipt || null
    });
    return { ok: true, ...result, productId };
  } catch (err) {
    console.error("verifyApplePurchase failed", { uid: request.auth?.uid || null, err });
    throw mapError(err);
  }
});

export const verifyProSubscription = onCall(fnOptions, async (request) => {
  try {
    const uid = requireAuth(request);
    const provider = String(request.data?.provider || "toss").trim().toLowerCase();
    const receipt = String(request.data?.receipt || "").trim();
    const transactionId = String(request.data?.transactionId || "").trim();
    if (!receipt && !transactionId) {
      throw new HttpsError("invalid-argument", "영수증 또는 거래 ID가 필요합니다.");
    }
    if (provider !== "toss" && provider !== "apple") {
      throw new HttpsError("invalid-argument", "지원하지 않는 결제 제공자입니다.");
    }

    const testPrefix = provider === "apple" ? "APPLE_TEST_" : "TOSS_TEST_";
    if (!receipt.startsWith(testPrefix) && !transactionId.startsWith(testPrefix)) {
      throw new HttpsError("failed-precondition", `실결제 검증 연동 전입니다. 테스트 값(${testPrefix}*)을 사용해 주세요.`);
    }

    const userRef = db.collection("users").doc(uid);
    const receiptHash = crypto.createHash("sha256").update(`${uid}:${receipt || transactionId}`).digest("hex");
    const eventId = `${provider}_pro_${transactionId || receiptHash}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 180);
    const eventRef = db.collection("purchaseEvents").doc(eventId);

    let granted = false;
    await db.runTransaction(async (tx) => {
      const eventSnap = await tx.get(eventRef);
      if (!eventSnap.exists) {
        tx.set(eventRef, {
          uid,
          provider,
          productId: PRODUCT_PRO_MONTHLY,
          transactionId: transactionId || null,
          receiptHash,
          rawReceipt: receipt || null,
          status: "granted",
          grantedAt: FieldValue.serverTimestamp()
        });
        granted = true;
      }

      tx.set(
        userRef,
        {
          plan: "pro",
          proProductId: PRODUCT_PRO_MONTHLY,
          proProvider: provider,
          proActivatedAt: FieldValue.serverTimestamp(),
          isAdFree: true,
          adFreePurchasedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    });

    return { ok: true, granted, plan: "pro", productId: PRODUCT_PRO_MONTHLY };
  } catch (err) {
    console.error("verifyProSubscription failed", { uid: request.auth?.uid || null, err });
    throw mapError(err);
  }
});

export const joinRoom = onCall(fnOptions, async (request) => {
  try {
    const uid = requireAuth(request);
    const groupId = (request.data?.groupId || "").trim();
    const password = (request.data?.password || "").trim();
    const acceptedRule = request.data?.acceptedRule === true;

    if (!groupId) {
      throw new HttpsError("invalid-argument", "groupId가 필요합니다.");
    }

    const userRef = db.collection("users").doc(uid);
    const groupRef = db.collection("groups").doc(groupId);
    const secretRef = db.collection("groupSecrets").doc(groupId);

    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      const userData = userSnap.exists ? userSnap.data() : {};
      const plan = normalizePlan(userData?.plan);
      const joined = normalizeJoinedGroupIds(userData);
      const maxGroups = maxGroupsByPlan(plan);

      const groupSnap = await tx.get(groupRef);
      if (!groupSnap.exists) {
        throw new Error("ROOM_NOT_FOUND");
      }

      const group = groupSnap.data();
      const members = Array.isArray(group.members) ? group.members : [];
      const status = group.status || "waiting";

      if (members.includes(uid)) {
        const nextJoined = joined.includes(groupRef.id) ? joined : [...joined, groupRef.id];
        tx.set(
          userRef,
          {
            currentGroupId: groupRef.id,
            currentGroupInviteCode: null,
            joinedGroupIds: nextJoined,
            plan
          },
          { merge: true }
        );
        return;
      }

      if (!joined.includes(groupRef.id) && joined.length >= maxGroups) {
        throw new Error("PLAN_LIMIT");
      }

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
      const ruleText = String(group.checkinRule || "").trim();
      if (ruleText && !acceptedRule) {
        throw new Error("RULE_NOT_ACCEPTED");
      }

      const nextMembers = [...members, uid];
      const nextJoined = joined.includes(groupRef.id) ? joined : [...joined, groupRef.id];
      tx.update(groupRef, { members: nextMembers });
      tx.set(
        userRef,
        {
          currentGroupId: groupRef.id,
          currentGroupInviteCode: null,
          joinedGroupIds: nextJoined,
          plan
        },
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

export const switchActiveGroup = onCall(fnOptions, async (request) => {
  try {
    const uid = requireAuth(request);
    const groupId = (request.data?.groupId || "").trim();
    if (!groupId) {
      throw new HttpsError("invalid-argument", "groupId가 필요합니다.");
    }

    const userRef = db.collection("users").doc(uid);
    const groupRef = db.collection("groups").doc(groupId);

    await db.runTransaction(async (tx) => {
      const [userSnap, groupSnap] = await Promise.all([tx.get(userRef), tx.get(groupRef)]);
      if (!groupSnap.exists) throw new Error("ROOM_NOT_FOUND");
      const group = groupSnap.data();
      const members = Array.isArray(group.members) ? group.members : [];
      if (!members.includes(uid)) throw new Error("NOT_MEMBER");

      const userData = userSnap.exists ? userSnap.data() : {};
      const joined = normalizeJoinedGroupIds(userData);
      const nextJoined = joined.includes(groupId) ? joined : [...joined, groupId];
      const plan = normalizePlan(userData?.plan);
      if (!joined.includes(groupId) && nextJoined.length > maxGroupsByPlan(plan)) {
        throw new Error("PLAN_LIMIT");
      }

      tx.set(
        userRef,
        {
          currentGroupId: groupId,
          currentGroupInviteCode: null,
          joinedGroupIds: nextJoined,
          plan
        },
        { merge: true }
      );
    });

    return { ok: true, groupId };
  } catch (err) {
    console.error("switchActiveGroup failed", {
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
      const joined = normalizeJoinedGroupIds(userData);

      if (!groupId) groupId = currentGroupId;
      if (!groupId) {
        tx.set(
          userRef,
          {
            currentGroupId: joined.length > 0 ? joined[0] : null,
            currentGroupInviteCode: null,
            joinedGroupIds: joined,
            lastChallengeStreak: userData?.currentChallengeStreak || 0,
            currentChallengeStreak: 0
          },
          { merge: true }
        );
        return;
      }

      const groupRef = db.collection("groups").doc(groupId);
      const groupSnap = await tx.get(groupRef);
      const wasActiveGroup = currentGroupId === groupId;
      const nextJoined = joined.filter((gid) => gid !== groupId);
      const nextCurrentGroupId = wasActiveGroup
        ? (nextJoined.length > 0 ? nextJoined[0] : null)
        : currentGroupId;

      tx.set(
        userRef,
        {
          currentGroupId: nextCurrentGroupId,
          currentGroupInviteCode: null,
          joinedGroupIds: nextJoined,
          lastChallengeStreak: wasActiveGroup ? (userData?.currentChallengeStreak || 0) : (userData?.lastChallengeStreak || 0),
          currentChallengeStreak: wasActiveGroup ? 0 : (userData?.currentChallengeStreak || 0)
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
      if (members.length === 2 && voterUid !== ownerUid) {
        throw new Error("NOT_OWNER");
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
          const joined = normalizeJoinedGroupIds(memberData);
          const nextJoined = joined.filter((gid) => gid !== groupId);
          const current = memberData?.currentGroupId || null;
          const nextCurrent = current === groupId ? (nextJoined.length > 0 ? nextJoined[0] : null) : current;
          tx.set(
            memberRef,
            {
              currentGroupId: nextCurrent,
              currentGroupInviteCode: null,
              joinedGroupIds: nextJoined,
              lastChallengeStreak: current === groupId ? (memberData?.currentChallengeStreak || 0) : (memberData?.lastChallengeStreak || 0),
              currentChallengeStreak: current === groupId ? 0 : (memberData?.currentChallengeStreak || 0)
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

function groupMemberStatsRef(groupId, uid) {
  return db.collection("groupMemberStats").doc(`${groupId}_${uid}`);
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
    const checkinRef = db.collection("checkins").doc(`${groupId}_${targetUid}_${date}`);
    const yesterdayRef = db.collection("checkins").doc(`${groupId}_${targetUid}_${yesterdayStr(date)}`);
    const statsRef = groupMemberStatsRef(groupId, targetUid);
    let approved = false;
    let votes = 0;
    let required = 0;

    await db.runTransaction(async (tx) => {
      const [groupSnap, checkinSnap, yesterdaySnap, statsSnap] = await Promise.all([
        tx.get(groupRef),
        tx.get(checkinRef),
        tx.get(yesterdayRef),
        tx.get(statsRef)
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
        const stats = statsSnap.exists ? statsSnap.data() : {};
        const currentStreak = Number(stats?.currentStreak || 0);
        const lastApprovedDate = String(stats?.lastApprovedDate || "");
        const prevApproved = yesterdaySnap.exists && (yesterdaySnap.data()?.status || "") === "approved";
        const isConsecutive = prevApproved && lastApprovedDate === yesterdayStr(date);
        const nextStreak = isConsecutive ? currentStreak + 1 : 1;
        const bestStreak = Math.max(Number(stats?.bestStreak || 0), nextStreak);

        tx.set(statsRef, {
          groupId,
          uid: targetUid,
          currentStreak: nextStreak,
          bestStreak,
          lastApprovedDate: date,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

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
    const checkinRef = db.collection("checkins").doc(`${groupId}_${targetUid}_${date}`);
    const statsRef = groupMemberStatsRef(groupId, targetUid);
    let rejected = false;
    let votes = 0;
    let required = 0;

    await db.runTransaction(async (tx) => {
      const [groupSnap, checkinSnap, statsSnap] = await Promise.all([
        tx.get(groupRef),
        tx.get(checkinRef),
        tx.get(statsRef)
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
        const stats = statsSnap.exists ? statsSnap.data() : {};
        const currentStreak = Number(stats?.currentStreak || 0);
        const lastApprovedDate = String(stats?.lastApprovedDate || "");
        tx.set(statsRef, {
          groupId,
          uid: targetUid,
          currentStreak: Math.max(currentStreak - 1, 0),
          lastApprovedDate: lastApprovedDate === date ? null : lastApprovedDate,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
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

async function executeMaintenanceCleanup() {
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
      const userSnap = await userRef.get();
      const userData = userSnap.exists ? userSnap.data() : {};
      const joined = normalizeJoinedGroupIds(userData);
      const nextJoined = joined.filter((groupKey) => groupKey !== gid);
      const current = userData?.currentGroupId || null;
      const nextCurrent = current === gid ? (nextJoined.length > 0 ? nextJoined[0] : null) : current;
      batch.set(
        userRef,
        { currentGroupId: nextCurrent, currentGroupInviteCode: null, joinedGroupIds: nextJoined },
        { merge: true }
      );
      summary.resetDanglingUsers += 1;
    }

    await batch.commit();
  }

  return summary;
}

export const runMaintenanceCleanup = onCall(fnOptions, async (request) => {
  try {
    requireAdmin(request);
    return await executeMaintenanceCleanup();
  } catch (err) {
    console.error("runMaintenanceCleanup failed", {
      uid: request.auth?.uid || null,
      email: request.auth?.token?.email || null,
      err
    });
    throw mapError(err);
  }
});

export const scheduledMaintenanceCleanup = onSchedule(
  { region: "asia-northeast3", schedule: "0 0 * * *", timeZone: "Asia/Seoul" },
  async () => {
    try {
      const summary = await executeMaintenanceCleanup();
      console.log("scheduledMaintenanceCleanup summary", summary);
    } catch (err) {
      console.error("scheduledMaintenanceCleanup failed", err);
    }
  }
);

export const notifyGroupStatusChanged = onDocumentUpdated(
  { region: "asia-northeast3", document: "groups/{groupId}" },
  async (event) => {
    try {
      const before = event.data?.before?.data();
      const after = event.data?.after?.data();
      if (!before || !after) return;
      if (before.status === after.status) return;

      const members = Array.isArray(after.members) ? after.members : [];
      if (!members.length) return;

      if (before.status === "waiting" && after.status === "active") {
        await sendPushToUids(members, {
          title: "챌린지 시작",
          body: `${after.title || "그룹"} 챌린지가 시작됐어요.`
        }, { type: "group_started", groupId: event.params.groupId });
      }

      if (after.status === "closed") {
        await sendPushToUids(members, {
          title: "방 해산",
          body: `${after.title || "그룹"} 방이 해산됐어요.`
        }, { type: "group_closed", groupId: event.params.groupId });
      }
    } catch (err) {
      console.error("notifyGroupStatusChanged failed", err);
    }
  }
);

export const notifyCheckinReviewed = onDocumentUpdated(
  { region: "asia-northeast3", document: "checkins/{checkinId}" },
  async (event) => {
    try {
      const before = event.data?.before?.data();
      const after = event.data?.after?.data();
      if (!before || !after) return;
      const beforeStatus = before.status || "pending";
      const afterStatus = after.status || "pending";
      if (beforeStatus === afterStatus) return;
      if (afterStatus !== "approved" && afterStatus !== "rejected") return;
      const targetUid = String(after.uid || "").trim();
      if (!targetUid) return;

      const title = afterStatus === "approved" ? "인증 승인" : "인증 반려";
      const body = afterStatus === "approved"
        ? "오늘 인증이 승인되었어요."
        : "오늘 인증이 반려되었어요. 사진을 다시 제출해 주세요.";

      await sendPushToUids([targetUid], { title, body }, {
        type: afterStatus === "approved" ? "checkin_approved" : "checkin_rejected",
        groupId: String(after.groupId || "")
      });
    } catch (err) {
      console.error("notifyCheckinReviewed failed", err);
    }
  }
);
