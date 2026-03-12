import crypto from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

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
    default:
      console.error("Unhandled function error:", err);
      return new HttpsError("internal", "서버 내부 오류가 발생했습니다.");
  }
}

export const createRoom = onCall({ region: "asia-northeast3" }, async (request) => {
  try {
    const uid = requireAuth(request);
    const { title, topic, visibility, password } = validateRoomInput(request.data);

    const userRef = db.collection("users").doc(uid);
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

      tx.set(userRef, { currentGroupId: groupRef.id, currentGroupInviteCode: null }, { merge: true });
    });

    return { groupId: groupRef.id, title };
  } catch (err) {
    throw mapError(err);
  }
});

export const joinRoom = onCall({ region: "asia-northeast3" }, async (request) => {
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
      tx.set(userRef, { currentGroupId: groupRef.id, currentGroupInviteCode: null }, { merge: true });
    });

    return { groupId };
  } catch (err) {
    throw mapError(err);
  }
});
